/** Shared between the Electron main process (engine, router, downloads) and the app UI. */
import type { Catalog, CatalogModel } from "./catalog"
import type { ModelShape } from "./fit"
import type { HubResult, HubSort } from "./huggingface"

/** OpenCode provider id of the local llama.cpp models (the `unvara-local` plugin). */
export const LOCAL_PROVIDER_ID = "unvara"

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
  /** Verified to drive the agent toolset at a long enough context; otherwise new chats start in Chat mode. */
  agent?: boolean
  reasoning: boolean
  vision: boolean
  sampling?: { temperature?: number; topK?: number; topP?: number; minP?: number }
  /** Advanced overrides written verbatim into the router preset section. */
  overrides?: Record<string, string | number | boolean>
  /** Where it came from, for models installed from the catalog. */
  source?: { catalogId: string; repo: string; quant: string }
  /** Architecture facts for memory estimates when the context or KV cache changes. */
  shape?: ModelShape
  /** Real generation speed from recent replies, averaged per engine backend. */
  measured?: { tokensPerSecond: number; backend?: EngineBackend; at: number }
  /** Files Unvara downloaded for it (shards + projector); deleted with the model. Imported models have none. */
  files?: string[]
  /** Bytes on disk (weights + projector). */
  size?: number
  installedAt?: number
}

/** What the model page can change; `overrides` replaces the whole set. */
export type ModelSettings = Partial<Pick<LocalModel, "context" | "overrides" | "sampling">>

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

/** Another app's model store that can be imported in place. */
export type ImportSource = { app: "lmstudio" | "ollama"; path: string }

export type DownloadStatus = "queued" | "downloading" | "paused" | "installing" | "done" | "failed"

/** Codes, not messages: the UI turns them into translated text. */
export type DownloadError = { code: "disk-full" | "integrity" | "network" | "install" | "unknown"; detail?: string }

export type DownloadFile = { url: string; dest: string; size: number; sha256: string }

/** One model download (all shards plus the vision projector); the queue survives restarts. */
export type DownloadJob = {
  /** `<catalogId>@<quant>` */
  id: string
  catalogId: string
  quant: string
  name: string
  files: DownloadFile[]
  total: number
  received: number
  /** Smoothed bytes per second while downloading. */
  speed: number
  status: DownloadStatus
  error?: DownloadError
  createdAt: number
}

export type LocalModelsSettings = {
  /** Folder for model files; `<modelsDir>/<publisher>/<repo>/<file>.gguf`. Latin-only path. */
  modelsDir: string
  /** Hugging Face endpoint (https://huggingface.co or a mirror such as https://hf-mirror.com). */
  mirror: string
  /** Set when the first-launch wizard is finished or skipped. */
  setupCompletedAt?: number
  /** Engine choice; "auto" (default) picks the fastest backend for this GPU. */
  backend?: EngineBackend | "auto"
  /** Unload the model after this many idle minutes to give VRAM back; 0 keeps it loaded. Default 15. */
  idleMinutes?: number
  /** Hugging Face access token for gated repos; only ever sent to huggingface.co. */
  hfToken?: string
}

export type LocalModelsState = {
  engine: EngineState
  /** A faster backend (e.g. CUDA) being provisioned while the current engine keeps serving. */
  engineUpgrade?: EngineState
  router: RouterState
  models: LocalModel[]
  downloads: DownloadJob[]
  settings: LocalModelsSettings
  system?: SystemInfo
  /** bun / uv installs for MCP connectors, while they happen. */
  runtimes?: Partial<Record<"bun" | "uv", RuntimeState>>
  /** MCP connectors added in Unvara; OpenCode merges them into its `mcp` config. */
  connectors: Record<string, Connector>
}

/** An MCP connector added in Unvara (same shape as OpenCode's `mcp` config entries). */
export type Connector =
  | { type: "local"; command: string[]; environment?: Record<string, string>; enabled?: boolean }
  | { type: "remote"; url: string; headers?: Record<string, string>; enabled?: boolean }

export type RuntimeState =
  | { status: "installing"; received: number; total: number }
  | { status: "ready" }
  | { status: "failed"; reason: string }

/** Renderer-facing API exposed by the desktop preload as `window.api.localModels` and via `platform.localModels`. */
export type LocalModelsPlatform = {
  getState: () => Promise<LocalModelsState>
  subscribe: (callback: (state: LocalModelsState) => void) => () => void
  scanHardware: () => Promise<SystemInfo>
  getCatalog: () => Promise<Catalog>
  /** Queues a catalog model; resolves with the job id. */
  download: (catalogId: string, quant: string) => Promise<string>
  pauseDownload: (id: string) => Promise<void>
  resumeDownload: (id: string) => Promise<void>
  /** Stops and deletes partial files; for finished jobs only clears the entry. */
  cancelDownload: (id: string) => Promise<void>
  removeModel: (id: string) => Promise<void>
  /** Saves a model's settings; they apply from the next reply. */
  updateModel: (id: string, patch: ModelSettings) => Promise<void>
  /** Live Hugging Face search over GGUF repos. */
  searchHub: (query: string, sort: HubSort, uncensored: boolean) => Promise<HubResult[]>
  /** A repo's quants and GGUF dims in catalog form (its id is `hf:<repo>`), ready to fit and download. */
  hubDetails: (repo: string) => Promise<CatalogModel>
  /** Folders other apps (LM Studio, Ollama) keep GGUF models in, if present. */
  importSources: () => Promise<ImportSource[]>
  /** Registers GGUF models found under `dir` in place; resolves with how many it found. */
  importFolder: (dir: string) => Promise<number>
  updateSettings: (patch: Partial<LocalModelsSettings>) => Promise<LocalModelsSettings>
  /** Switches the engine (installing it if needed) and restarts the router on it. */
  setBackend: (backend: EngineBackend | "auto") => Promise<void>
  /** Installs bun / uv for an npx / uvx connector unless the PC has the real tool; false if that failed. */
  ensureConnectorRuntime: (command: string) => Promise<boolean>
  /** Adds or replaces a connector; undefined removes it. OpenCode picks it up once it reloads its config. */
  setConnector: (name: string, connector: Connector | undefined) => Promise<void>
}
