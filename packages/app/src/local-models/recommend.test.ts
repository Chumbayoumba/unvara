import { describe, expect, test } from "bun:test"
import bundled from "../../../../catalog/catalog.json"
import type { Catalog } from "./catalog"
import type { HardwareProfile } from "./fit"
import { agentReady, recommend } from "./recommend"

const catalog = bundled as Catalog
const GB = 1024 ** 3

// The test bench: RTX 3070 Ti 8 GB (~1 GB held by other apps), Ryzen 5 7600, 32 GB DDR5, NVMe.
const desktop: HardwareProfile = {
  gpu: { name: "NVIDIA GeForce RTX 3070 Ti", vram: 8 * GB, vramFree: 7 * GB, backend: "cuda-13.4" },
  ram: { total: 32 * GB, available: 20 * GB, bandwidth: 60 },
  cpu: { cores: 6 },
  disk: { free: 500e9, kind: "nvme" },
}

const laptop: HardwareProfile = {
  ram: { total: 16 * GB, available: 9 * GB, bandwidth: 40 },
  cpu: { cores: 8 },
  disk: { free: 200e9, kind: "ssd" },
}

describe("recommend", () => {
  test("8 GB GPU + 32 GB RAM: MoE with experts in RAM as the balanced pick, all picks uncensored", () => {
    const result = recommend(catalog, desktop)
    const picks = [result.picks.fast, result.picks.balanced, result.picks.quality]
    expect(picks.every((item) => item?.model.uncensored)).toBe(true)
    expect(new Set(picks.map((item) => item?.model.id)).size).toBe(3)
    expect(result.picks.fast?.best.fit.mode).toBe("gpu")
    expect(result.picks.balanced?.model.id).toBe("qwen3.6-35b-a3b-abliterated")
    expect(result.picks.balanced?.best.fit).toMatchObject({ mode: "moe-offload", context: 32768 })
    expect(result.picks.quality!.model.paramsTotal).toBeGreaterThan(result.picks.fast!.model.paramsTotal)
  })

  test("prefers a long context with part of the model in RAM over a GPU-only fit with a tiny context", () => {
    const vision = recommend(catalog, desktop).fits.find((item) => item.model.id === "qwen3-vl-8b-abliterated")
    expect(vision?.quants.every((item) => item.fit.context >= 8192)).toBe(true)
  })

  test("never recommends a 284B model to a desktop PC", () => {
    const deepseek = recommend(catalog, desktop).fits.find((item) => item.model.id === "deepseek-v4-flash-abliterated")
    expect(["extreme", "wont-run"]).toContain(deepseek!.best.fit.tier)
  })

  test("a laptop without a GPU still gets small, usable models and no official twin of a pick", () => {
    const result = recommend(catalog, laptop)
    expect(result.picks.fast!.best.fit.mode).toBe("cpu")
    expect(result.picks.fast!.model.paramsTotal).toBeLessThan(10e9)
    const bases = [result.picks.fast, result.picks.balanced, result.picks.quality].flatMap((item) =>
      item ? [item.model.base] : [],
    )
    expect(new Set(bases).size).toBe(bases.length)
  })

  test("only curated tool callers get the agent badge", () => {
    const fits = recommend(catalog, desktop).fits
    const badge = (id: string) => {
      const item = fits.find((fit) => fit.model.id === id)!
      return agentReady(item.model, item.best.fit)
    }
    expect(badge("qwen3.6-35b-a3b-abliterated")).toBe(true)
    // Its chat template supports tools, but a 3B model loops on malformed calls.
    expect(badge("llama-3.2-3b-abliterated")).toBe(false)
  })

  test("a model that runs ideally gets a higher-quality quant than the default", () => {
    const llama = recommend(catalog, desktop).fits.find((item) => item.model.id === "llama-3.2-3b-abliterated")
    expect(llama?.best.fit.tier).toBe("ideal")
    expect(llama?.best.quant.quant).toBe("Q6_K")
  })
})
