/** Shared between the Electron main process (engine, router, downloads) and the app UI. */

export type EngineBackend = "cpu" | "vulkan" | "cuda-12.4" | "cuda-13.4"

export type GpuInfo = {
  name: string
  vendor: "nvidia" | "amd" | "intel" | "other"
  /** Dedicated VRAM in bytes (registry `HardwareInformation.qwMemorySize`, never the 4 GB-capped WMI value). */
  vram: number
  driver?: string
  /** NVIDIA only, e.g. 8.6 */
  computeCap?: number
  /** NVIDIA only, bytes */
  vramFree?: number
  integrated: boolean
}

export type DiskInfo = {
  /** Drive letter without colon, e.g. "D". */
  letter: string
  free: number
  size: number
  kind: "nvme" | "ssd" | "hdd" | "unknown"
}

export type SystemInfo = {
  gpus: GpuInfo[]
  ram: { total: number; available: number; /** GB/s, measured */ bandwidth?: number }
  cpu: { name: string; cores: number }
  disks: DiskInfo[]
  os: string
  scannedAt: number
}

/** A llama.cpp device as reported by `llama-server --list-devices`, e.g. `Vulkan0`. */
export type EngineDevice = { id: string; name: string; total: number; free: number }

/** One installed local model. Also the entry the OpenCode `unvara-local` plugin turns into a provider model. */
export type LocalModel = {
  id: string
  name: string
  path: string
  mmproj?: string
  /** Fitted context window in tokens. */
  context: number
  /** Max output tokens advertised to OpenCode. */
  output: number
  toolCall: boolean
  reasoning: boolean
  vision: boolean
  sampling?: { temperature?: number; topK?: number; topP?: number; minP?: number }
  /** Advanced overrides written verbatim into the router preset section. */
  overrides?: Record<string, string | number | boolean>
}

/** `models.json` in the engine folder: the single source for the router presets and the OpenCode plugin. */
export type LocalModelsManifest = { version: 1; models: LocalModel[] }

export type EngineState =
  | { status: "absent" }
  | { status: "downloading"; backend: EngineBackend; received: number; total: number }
  | { status: "verifying"; backend: EngineBackend }
  | { status: "testing"; backend: EngineBackend }
  | { status: "ready"; backend: EngineBackend; build: string; device?: EngineDevice }
  | { status: "failed"; reason: string }

export type RouterState =
  | { status: "stopped" }
  | { status: "starting" }
  | { status: "idle" }
  | { status: "loading"; model: string; progress?: number }
  | { status: "ready"; model: string }
  | { status: "crashed"; reason: string }
  | { status: "restarting"; attempt: number }

export type LocalModelsState = {
  engine: EngineState
  router: RouterState
  models: LocalModel[]
  system?: SystemInfo
}

/** Renderer-facing API exposed by the desktop preload as `window.api.localModels` and via `platform.localModels`. */
export type LocalModelsPlatform = {
  getState: () => Promise<LocalModelsState>
  subscribe: (callback: (state: LocalModelsState) => void) => () => void
  scanHardware: () => Promise<SystemInfo>
}
