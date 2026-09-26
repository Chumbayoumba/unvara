/**
 * Hardware fit engine: where a GGUF model can live (VRAM / RAM / SSD), which context it gets, how fast it runs
 * and which tier to show. Placement follows Jan's `planModelLoad` (Apache-2.0, fixed to use total RAM and
 * head_count_kv); speed follows llmfit's bandwidth roofline (MIT, © 2026 Alex Jones). Pure and synchronous.
 */
import { gpuBandwidth } from "./gpu-bandwidth"
import { qualityPenalty } from "./quant"
import type { EngineBackend, GpuInfo, SystemInfo } from "./types"

const GIB = 1024 ** 3
const VRAM_RESERVE = 1 * GIB // = llama.cpp --fit-target default
const DESKTOP_VRAM = 1 * GIB
const RAM_RESERVE = 2 * GIB
const COMPUTE_BUFFER = 0.5 * GIB
const EFFICIENCY = 0.55 // llmfit: achieved share of theoretical bandwidth
const MIN_CONTEXT = 4096
const COMFORT_CONTEXT = 8192
const MODE_ORDER = ["gpu", "moe-offload", "hybrid", "cpu", "ssd"] as const
// Faster than reading speed adds little, so the score's speed term saturates here (llmfit uses 40).
const COMFORT_SPEED = 20

export type HardwareProfile = {
  gpu?: { name: string; vram: number; vramFree?: number; backend: EngineBackend }
  ram: { total: number; available: number; bandwidth?: number }
  cpu: { cores: number }
  disk?: { free: number; kind: "nvme" | "ssd" | "hdd" | "unknown" }
}

/** Architecture facts from the GGUF header. */
export type ModelShape = {
  paramsTotal: number
  /** MoE: parameters used per token. Dense models omit it. */
  paramsActive?: number
  layers: number
  /** KV heads and head sizes of the full-attention layers. */
  headCountKv: number
  keyLength: number
  valueLength: number
  /** Layers whose KV cache grows with the context (defaults to all layers); hybrid, linear-attention and
   * sliding-window archs have fewer. */
  fullAttentionLayers?: number
  /** Sliding-window layers: their cache never grows past the window. */
  swa?: { layers: number; window: number; headCountKv: number; keyLength: number; valueLength: number }
  contextMax: number
}

export type KvType = "f16" | "q8_0"
export type Mode = "gpu" | "moe-offload" | "hybrid" | "cpu" | "ssd" | "none"
export type Tier = "ideal" | "good" | "slow" | "extreme" | "wont-run"

export type Fit = {
  tier: Tier
  mode: Mode
  context: number
  kvType: KvType
  /** Layers llama.cpp should keep on the GPU (all layers for "gpu"). */
  gpuLayers: number
  /** Total bytes the model needs at `context` (weights + KV + buffers). */
  need: number
  tokensPerSecond: number
  /** need / usable budget of the limiting pool; 0 when nothing fits. */
  ratio: number
  /** Bytes that must sit in system RAM / on the GPU, so the UI can ask to close apps when either is short now. */
  ram: number
  vram: number
}

export function kvBytesPerToken(shape: ModelShape, kvType: KvType) {
  const bytes = kvType === "f16" ? 2 : 1.0625
  const layers = shape.fullAttentionLayers ?? shape.layers
  return layers * shape.headCountKv * (shape.keyLength + shape.valueLength) * bytes
}

export function kvBytes(shape: ModelShape, context: number, kvType: KvType) {
  const swa = shape.swa
  if (!swa) return kvBytesPerToken(shape, kvType) * context
  // llama.cpp keeps the window plus one micro-batch (512) of cache on sliding-window layers.
  const windowed = kvBytesPerToken({ ...shape, ...swa, fullAttentionLayers: swa.layers }, kvType)
  return kvBytesPerToken(shape, kvType) * context + windowed * Math.min(context, swa.window + 512)
}

export function planFit(
  shape: ModelShape,
  file: { size: number; mmprojSize?: number },
  hardware: HardwareProfile,
  options: { targetContext: number; minContext?: number },
): Fit {
  const target = Math.min(options.targetContext, shape.contextMax)
  const floor = Math.min(options.minContext ?? MIN_CONTEXT, target)
  const contexts = [target, ...halvings(target, floor)]
  const attempts = contexts.flatMap((context) =>
    (["f16", "q8_0"] as const).map((kvType) => place(shape, file, hardware, context, kvType)),
  )
  // Best placement wins; among equals prefer the larger context, then f16 KV. A context below 8k is too short
  // for real use, so it only counts when nothing fits at 8k or more.
  const byMode = (fits: Fit[]) => MODE_ORDER.map((mode) => fits.find((fit) => fit.mode === mode)).find(Boolean)
  const best =
    byMode(attempts.filter((fit) => fit.context >= Math.min(COMFORT_CONTEXT, target))) ??
    byMode(attempts) ??
    attempts[attempts.length - 1]
  // A model that only fits by shrinking the context below the target is never "ideal".
  if (best.tier === "ideal" && best.context < target) return { ...best, tier: "good" }
  return best
}

/** The discrete GPU models run on; integrated and tiny adapters are never used. */
export function primaryGpu(gpus: GpuInfo[]) {
  return gpus.find((gpu) => !gpu.integrated && gpu.vram >= 2 * GIB)
}

/** The fit engine's view of a scanned PC running `backend`, with models stored on `drive`. */
export function hardwareProfile(system: SystemInfo, backend: EngineBackend, drive?: string): HardwareProfile {
  const gpu = primaryGpu(system.gpus)
  const disk = system.disks.find((item) => item.letter === drive?.slice(0, 1).toUpperCase())
  return {
    gpu: gpu && backend !== "cpu" ? { name: gpu.name, vram: gpu.vram, vramFree: gpu.vramFree, backend } : undefined,
    ram: system.ram,
    cpu: { cores: system.cpu.cores },
    disk: disk ? { free: disk.free, kind: disk.kind } : undefined,
  }
}

function place(
  shape: ModelShape,
  file: { size: number; mmprojSize?: number },
  hardware: HardwareProfile,
  context: number,
  kvType: KvType,
): Fit {
  const weights = file.size + (file.mmprojSize ?? 0)
  const kv = kvBytes(shape, context, kvType)
  const need = weights + kv + COMPUTE_BUFFER
  // Like RAM, VRAM is planned for a PC with other apps closed: browsers and chat apps often hold several GB that
  // Windows hands back, while the desktop itself keeps roughly DESKTOP_VRAM (the UI asks to close apps when short).
  const gpu = hardware.gpu
  const vram = gpu ? Math.max(0, Math.max(gpu.vramFree ?? gpu.vram, gpu.vram - DESKTOP_VRAM) - VRAM_RESERVE) : 0
  // Recommendations assume the user can close other apps: plan against at least 75 % of total RAM rather than
  // whatever happens to be free right now (the UI warns separately when current free memory is short).
  const ram = Math.max(0, Math.max(hardware.ram.available, hardware.ram.total * 0.75) - RAM_RESERVE)
  const activeShare = shape.paramsActive ? Math.min(1, shape.paramsActive / shape.paramsTotal) : 1
  const perToken = weights * activeShare
  const base = { context, kvType, need }

  if (vram > 0 && need <= vram) {
    const ratio = need / vram
    return { ...base, mode: "gpu", gpuLayers: shape.layers, ratio, ram: 0, vram: need, tier: ratio <= 0.85 ? "ideal" : "good",
      tokensPerSecond: speed(perToken, 0, hardware) }
  }

  // MoE: attention, KV and as many experts as fit stay on the GPU; the rest of the experts live in RAM.
  // Only the active experts are read per token, which is why this runs well on 8 GB cards.
  if (vram > 0 && activeShare < 0.5) {
    const onGpu = Math.max(0, vram - kv - COMPUTE_BUFFER)
    const inRam = weights - onGpu
    if (onGpu > 0 && inRam <= ram) {
      const cpuShare = inRam / weights
      const tokensPerSecond = speed(perToken * (1 - cpuShare), perToken * cpuShare, hardware)
      return { ...base, mode: "moe-offload", gpuLayers: shape.layers, ratio: inRam / Math.max(ram, 1), ram: inRam,
        vram: need - inRam, tier: tokensPerSecond >= 8 ? "good" : "slow", tokensPerSecond }
    }
  }

  // Dense hybrid: whole layers (with their KV) on the GPU, the rest on the CPU.
  const layerSize = weights / (shape.layers + 2)
  const kvPerLayer = kv / shape.layers
  const gpuLayers = vram > 0 ? Math.min(shape.layers, Math.floor((vram - COMPUTE_BUFFER) / (layerSize + kvPerLayer))) : 0
  if (gpuLayers >= 1) {
    const gpuShare = gpuLayers / shape.layers
    const inRam = (weights + kv) * (1 - gpuShare)
    if (inRam <= ram) {
      const tokensPerSecond = speed(perToken * gpuShare, perToken * (1 - gpuShare), hardware)
      return { ...base, mode: "hybrid", gpuLayers, ratio: inRam / Math.max(ram, 1), ram: inRam, vram: need - inRam,
        tier: gpuShare >= 0.7 && tokensPerSecond >= 8 ? "good" : "slow", tokensPerSecond }
    }
  }

  if (need <= ram) {
    return { ...base, mode: "cpu", gpuLayers: 0, ratio: need / Math.max(ram, 1), ram: need, vram: 0, tier: "slow",
      tokensPerSecond: speed(0, perToken, hardware) }
  }

  // Doesn't fit in VRAM + RAM: llama.cpp can still mmap the file and stream the rest from a fast SSD.
  const disk = hardware.disk
  if (disk && (disk.kind === "nvme" || disk.kind === "ssd") && weights <= disk.free) {
    const resident = Math.max(0, ram + vram - kv - COMPUTE_BUFFER)
    const streamed = Math.max(0, perToken - resident * activeShare)
    const ssd = (disk.kind === "nvme" ? 3 : 0.5) * GIB
    return { ...base, mode: "ssd", gpuLayers: 0, ratio: 0, ram, vram: 0, tier: "extreme",
      tokensPerSecond: 1 / (streamed / ssd + perToken / bandwidth(hardware, "ram")) }
  }

  return { ...base, mode: "none", gpuLayers: 0, ratio: 0, ram: 0, vram: 0, tier: "wont-run", tokensPerSecond: 0 }
}

/** Bandwidth roofline: every generated token reads the active weights once from wherever they live. */
function speed(gpuBytes: number, cpuBytes: number, hardware: HardwareProfile) {
  const seconds = gpuBytes / bandwidth(hardware, "gpu") + cpuBytes / bandwidth(hardware, "ram")
  return seconds > 0 ? EFFICIENCY / seconds : 0
}

function bandwidth(hardware: HardwareProfile, pool: "gpu" | "ram") {
  if (pool === "ram") return (hardware.ram.bandwidth ?? 50) * 1e9
  const gpu = hardware.gpu
  if (!gpu) return (hardware.ram.bandwidth ?? 50) * 1e9
  const known = gpuBandwidth(gpu.name)
  // Unknown or laptop GPU: conservative guess by VRAM class.
  const guess = gpu.vram >= 16 * GIB ? 450 : gpu.vram >= 8 * GIB ? 300 : 180
  // Measured on an RTX 3070 Ti (Qwen3-4B Q4_K_M): CUDA 138 tok/s vs Vulkan 33 tok/s, so Vulkan on NVIDIA is
  // modelled at ~0.3 of CUDA; on AMD/Intel Vulkan is the native path and gets most of the bus.
  const backend = gpu.backend === "vulkan" ? (/nvidia|geforce|rtx|gtx|quadro/i.test(gpu.name) ? 0.3 : 0.85) : 1
  return (known ?? guess) * backend * 1e9
}

function halvings(from: number, floor: number) {
  const out: number[] = []
  for (let value = Math.floor(from / 2); value >= floor; value = Math.floor(value / 2)) out.push(value)
  if (out[out.length - 1] !== floor && floor < from) out.push(floor)
  return out
}

/**
 * Score for picking recommendations (llmfit weights for chat: quality .40, speed .35, fit .15, context .10).
 * Quality comes from active parameter count plus the quant penalty.
 */
export function score(fit: Fit, model: { paramsActiveB: number; quant: string }, targetContext: number) {
  if (fit.tier === "wont-run") return 0
  const params = model.paramsActiveB
  const base = params < 1 ? 30 : params < 3 ? 45 : params < 7 ? 60 : params < 10 ? 75 : params < 20 ? 82 : params < 40 ? 89 : 95
  const quality = Math.max(0, base + qualityPenalty(model.quant))
  const speedScore = Math.min(100, (fit.tokensPerSecond / COMFORT_SPEED) * 100)
  const fitScore = fit.ratio <= 0.7 ? 100 : 100 * Math.exp(-0.5 * ((fit.ratio - 0.7) / 0.2) ** 2)
  const contextScore = fit.context >= targetContext ? 100 : fit.context >= targetContext / 2 ? 70 : 30
  return quality * 0.4 + speedScore * 0.35 + fitScore * 0.15 + contextScore * 0.1
}
