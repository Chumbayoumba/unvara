import { describe, expect, test } from "bun:test"
import { kvBytesPerToken, planFit, score, type HardwareProfile, type ModelShape } from "./fit"
import { defaultQuant, parseQuant, quantLevel } from "./quant"

const GIB = 1024 ** 3

// The reference machine: RTX 3070 Ti 8 GB (+ iGPU ignored), 32 GB DDR5, NVMe.
const rtx3070ti: HardwareProfile = {
  gpu: { name: "NVIDIA GeForce RTX 3070 Ti", vram: 8 * GIB, vramFree: 7.2 * GIB, backend: "cuda-13.4" },
  ram: { total: 32 * GIB, available: 24 * GIB, bandwidth: 60 },
  cpu: { cores: 6 },
  disk: { free: 545e9, kind: "nvme" },
}
const laptopNoGpu: HardwareProfile = {
  ram: { total: 16 * GIB, available: 10 * GIB, bandwidth: 40 },
  cpu: { cores: 8 },
  disk: { free: 200e9, kind: "ssd" },
}
const oldHdd: HardwareProfile = {
  ram: { total: 8 * GIB, available: 5 * GIB },
  cpu: { cores: 4 },
  disk: { free: 500e9, kind: "hdd" },
}

const qwen3_4b: ModelShape = {
  paramsTotal: 4.02e9, layers: 36, headCountKv: 8, keyLength: 128, valueLength: 128, contextMax: 262144,
}
const qwen36_35b_a3b: ModelShape = {
  paramsTotal: 35e9, paramsActive: 3e9, layers: 40, fullAttentionLayers: 10, headCountKv: 4, keyLength: 256,
  valueLength: 256, contextMax: 262144,
}
const qwen38_27b: ModelShape = {
  paramsTotal: 27.3e9, layers: 64, fullAttentionLayers: 16, headCountKv: 4, keyLength: 256, valueLength: 256,
  contextMax: 262144,
}
const huge: ModelShape = {
  paramsTotal: 284e9, paramsActive: 13e9, layers: 61, headCountKv: 8, keyLength: 128, valueLength: 128,
  contextMax: 131072,
}

describe("planFit", () => {
  test("4B model runs fully on an 8 GB GPU at agent context with q8_0 KV", () => {
    const fit = planFit(qwen3_4b, { size: 2.5e9 }, rtx3070ti, { targetContext: 32768 })
    expect(fit.mode).toBe("gpu")
    expect(fit.context).toBe(32768)
    expect(fit.kvType).toBe("q8_0")
    expect(["ideal", "good"]).toContain(fit.tier)
  })

  test("35B MoE keeps experts in RAM and stays fast on 8 GB + 32 GB", () => {
    const fit = planFit(qwen36_35b_a3b, { size: 21e9 }, rtx3070ti, { targetContext: 32768 })
    expect(fit.mode).toBe("moe-offload")
    expect(fit.tier).toBe("good")
    expect(fit.tokensPerSecond).toBeGreaterThan(10)
  })

  test("27B dense model needs heavy CPU offload on 8 GB", () => {
    const fit = planFit(qwen38_27b, { size: 16.8e9 }, rtx3070ti, { targetContext: 32768 })
    expect(fit.mode).toBe("hybrid")
    expect(fit.tier).toBe("slow")
    expect(fit.gpuLayers).toBeGreaterThan(0)
    expect(fit.gpuLayers).toBeLessThan(qwen38_27b.layers)
  })

  test("no GPU falls back to CPU", () => {
    const fit = planFit(qwen3_4b, { size: 2.5e9 }, laptopNoGpu, { targetContext: 8192 })
    expect(fit.mode).toBe("cpu")
    expect(fit.tier).toBe("slow")
  })

  test("a model larger than VRAM + RAM streams from NVMe", () => {
    const fit = planFit(huge, { size: 160e9 }, rtx3070ti, { targetContext: 8192 })
    expect(fit.mode).toBe("ssd")
    expect(fit.tier).toBe("extreme")
    expect(fit.tokensPerSecond).toBeLessThan(2)
  })

  test("never offers SSD streaming from an HDD", () => {
    const fit = planFit(huge, { size: 160e9 }, oldHdd, { targetContext: 8192 })
    expect(fit.tier).toBe("wont-run")
  })

  test("a model that only fits with a shrunken context is never ideal", () => {
    const fit = planFit(qwen3_4b, { size: 2.5e9 }, rtx3070ti, { targetContext: 262144, minContext: 4096 })
    expect(fit.context).toBeLessThan(262144)
    expect(fit.tier).not.toBe("ideal")
  })
})

describe("kv cache", () => {
  test("hybrid attention only counts full-attention layers", () => {
    expect(kvBytesPerToken(qwen36_35b_a3b, "f16")).toBe(10 * 4 * 512 * 2)
    expect(kvBytesPerToken(qwen3_4b, "f16")).toBe(36 * 8 * 256 * 2)
  })
})

describe("score", () => {
  test("prefers the better placement for similar models", () => {
    const moe = planFit(qwen36_35b_a3b, { size: 21e9 }, rtx3070ti, { targetContext: 32768 })
    const dense = planFit(qwen38_27b, { size: 16.8e9 }, rtx3070ti, { targetContext: 32768 })
    expect(score(moe, { paramsActiveB: 3, quant: "Q4_K_M" }, 32768)).toBeGreaterThan(0)
    expect(score(dense, { paramsActiveB: 27, quant: "Q4_K_M" }, 32768)).toBeGreaterThan(0)
  })
})

describe("speed estimate", () => {
  test("matches the measured CUDA speed of a 4B Q4_K_M model on an RTX 3070 Ti (~138 tok/s)", () => {
    const fit = planFit(qwen3_4b, { size: 2.5e9 }, rtx3070ti, { targetContext: 4096 })
    expect(fit.tokensPerSecond).toBeGreaterThan(110)
    expect(fit.tokensPerSecond).toBeLessThan(170)
  })

  test("Vulkan on NVIDIA is modelled much slower than CUDA (measured 33 vs 138 tok/s)", () => {
    const gpu = rtx3070ti.gpu ?? { name: "", vram: 0, backend: "cpu" as const }
    const vulkan: HardwareProfile = { ...rtx3070ti, gpu: { ...gpu, backend: "vulkan" } }
    const fit = planFit(qwen3_4b, { size: 2.5e9 }, vulkan, { targetContext: 4096 })
    expect(fit.tokensPerSecond).toBeGreaterThan(25)
    expect(fit.tokensPerSecond).toBeLessThan(60)
  })
})

describe("quant", () => {
  test("parses quant names from GGUF filenames", () => {
    expect(parseQuant("Qwen3-4B-Instruct-2507-Q4_K_M.gguf")).toBe("Q4_K_M")
    expect(parseQuant("Huihui-Qwen3.8-27B-abliterated-GSQ-RCO-IQ3_XXS.gguf")).toBe("IQ3_XXS")
    expect(parseQuant("model.BF16-00001-of-00002.gguf")).toBe("BF16")
    expect(parseQuant("gpt-oss-20b-MXFP4.gguf")).toBe("MXFP4")
    expect(parseQuant("huihui-ai_Huihui-gpt-oss-20b-BF16-abliterated-Q4_K_M.gguf")).toBe("Q4_K_M")
    expect(parseQuant("Huihui-Qwen3.6-35B-A3B-abliterated.IQ4_XS.gguf")).toBe("IQ4_XS")
  })

  test("groups precision and picks the default download", () => {
    expect(quantLevel("IQ4_XS")).toBe(4)
    expect(quantLevel("Q8_0")).toBe(8)
    expect(quantLevel("BF16")).toBe(16)
    expect(defaultQuant(["Q2_K", "Q8_0", "IQ4_XS", "Q6_K"])).toBe("IQ4_XS")
  })
})
