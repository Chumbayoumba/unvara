import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { net } from "electron"
import type { EngineBackend, GpuInfo, LocalModel, LocalModelsState } from "@opencode-ai/app/local-models/types"
import { localDataRoot } from "../paths"
import { ENGINE_BUILD, engineDir, installedBackend, isInstalled, preferredBackend, provisionBackend } from "./engine"
import { detectSystem, listEngineDevices, pickDevice, primaryGpu } from "./hardware"
import { readManifest, writeManifest, writePresets } from "./presets"
import { createRouter, type Router } from "./router"

type Logger = (message: string, extra?: Record<string, unknown>, level?: "info" | "warn" | "error") => void

/**
 * Owns the local AI stack: hardware facts, the llama.cpp engine, the router process and the installed-models
 * manifest shared with the OpenCode `unvara-local` plugin.
 */
export function createLocalModelsController(options: { userDataPath: string; log: Logger; routerLog: Logger }) {
  const localRoot = localDataRoot(options.userDataPath)
  const engineRoot = join(localRoot, "engine")
  const files = {
    manifest: join(engineRoot, "models.json"),
    presets: join(engineRoot, "models.ini"),
    pid: join(engineRoot, "router.pid"),
    cache: join(engineRoot, "cache"),
  }
  const state: LocalModelsState = {
    engine: { status: "absent" },
    router: { status: "stopped" },
    models: readManifest(files.manifest).models,
  }
  const listeners = new Set<(state: LocalModelsState) => void>()
  const runtime = { router: undefined as Router | undefined, port: 0, apiKey: "" }

  function emit(patch: Partial<LocalModelsState>) {
    Object.assign(state, patch)
    listeners.forEach((listener) => listener(state))
  }

  /**
   * Must run before the OpenCode sidecar is spawned: the sidecar inherits these variables and the plugin builds
   * the provider from them, so the endpoint stays valid for the whole session even across router restarts.
   */
  async function prepare() {
    mkdirSync(files.cache, { recursive: true })
    runtime.port = await freePort()
    runtime.apiKey = randomUUID()
    Object.assign(process.env, {
      UNVARA_LLAMA_URL: `http://127.0.0.1:${runtime.port}/v1`,
      UNVARA_LLAMA_KEY: runtime.apiKey,
      UNVARA_MODELS_MANIFEST: files.manifest,
    })
  }

  async function scanHardware() {
    const system = await detectSystem()
    options.log("hardware scanned", {
      gpus: system.gpus.map((gpu) => `${gpu.name} ${(gpu.vram / 1024 ** 3).toFixed(1)}GB${gpu.integrated ? " (integrated)" : ""}`),
      ram: `${(system.ram.total / 1024 ** 3).toFixed(1)}GB total, ${(system.ram.available / 1024 ** 3).toFixed(1)}GB available, ${system.ram.bandwidth ?? "?"}GB/s`,
      cpu: `${system.cpu.name} x${system.cpu.cores}`,
      disks: system.disks.map((disk) => `${disk.letter}: ${disk.kind} ${(disk.free / 1e9).toFixed(0)}GB free`),
    })
    emit({ system })
    return system
  }

  async function start() {
    const system = await scanHardware()
    const gpu = primaryGpu(system.gpus)
    const current = installedBackend(localRoot, gpu)
    await launch(current, gpu)
    // Local AI works right away on what ships with the installer; a faster backend (CUDA) is fetched in the
    // background and swapped in without changing the endpoint OpenCode talks to.
    const upgrades = upgradeCandidates(preferredBackend(gpu), current)
    if (upgrades.length) void upgrade(upgrades, gpu)
  }

  async function launch(backend: EngineBackend, gpu: GpuInfo | undefined) {
    const binaryDir = engineDir(localRoot, backend)
    const device =
      backend === "cpu" ? undefined : pickDevice(await listEngineDevices(join(binaryDir, "llama-server.exe")), gpu)
    if (backend !== "cpu" && !device) throw new Error(`${backend} engine cannot see ${gpu?.name ?? "the GPU"}`)
    options.log("local engine selected", { backend, build: ENGINE_BUILD, gpu: gpu?.name, device: device?.id })
    runtime.router?.stopSync()
    emit({ engine: { status: "ready", backend, build: ENGINE_BUILD, device } })
    writePresets(files.presets, state.models, device)
    const router = createRouter({
      binaryDir,
      presetsFile: files.presets,
      pidFile: files.pid,
      cacheDir: files.cache,
      port: runtime.port,
      apiKey: runtime.apiKey,
      log: options.routerLog,
      onState: (router) => emit({ router }),
    })
    runtime.router = router
    await router.start()
  }

  /** Tries each candidate (e.g. CUDA 13 → CUDA 12.4); the first one that sees the GPU replaces the engine. */
  async function upgrade(candidates: EngineBackend[], gpu: GpuInfo | undefined) {
    for (const backend of candidates) {
      const ok = await provisionAndVerify(backend, gpu)
      if (!ok) continue
      // Never pull the engine out from under a running generation; otherwise it applies on next launch.
      if (state.router.status === "idle") {
        await launch(backend, gpu)
        emit({ engineUpgrade: undefined })
        return
      }
      emit({ engineUpgrade: { status: "ready", backend, build: ENGINE_BUILD } })
      return
    }
  }

  async function provisionAndVerify(backend: EngineBackend, gpu: GpuInfo | undefined) {
    try {
      if (!isInstalled(localRoot, backend)) {
        emit({ engineUpgrade: { status: "downloading", backend, received: 0, total: 0 } })
        await provisionBackend(localRoot, backend, {
          fetch: net.fetch,
          onProgress: (received, total) => emit({ engineUpgrade: { status: "downloading", backend, received, total } }),
        })
      }
      emit({ engineUpgrade: { status: "testing", backend } })
      const devices = await listEngineDevices(join(engineDir(localRoot, backend), "llama-server.exe"))
      if (!pickDevice(devices, gpu)) throw new Error(`${backend} engine cannot see ${gpu?.name}`)
      return true
    } catch (error) {
      options.log("engine upgrade failed", { backend, error: String(error) }, "error")
      emit({ engineUpgrade: { status: "failed", reason: String(error) } })
      return false
    }
  }

  /** Registers (or replaces) a model and makes the router pick it up without a restart. */
  async function upsertModel(model: LocalModel) {
    const models = [...state.models.filter((item) => item.id !== model.id), model]
    writeManifest(files.manifest, { version: 1, models })
    emit({ models })
    const device = state.engine.status === "ready" ? state.engine.device : undefined
    writePresets(files.presets, models, device)
    await runtime.router?.reload()
  }

  return {
    prepare,
    start,
    scanHardware,
    upsertModel,
    stopSync: () => runtime.router?.stopSync(),
    load: (model: string) => runtime.router?.load(model),
    getState: () => state,
    subscribe(listener: (state: LocalModelsState) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export type LocalModelsController = ReturnType<typeof createLocalModelsController>

/** Backends worth fetching after `current`, best first; CUDA 12.4 is the fallback when CUDA 13 fails. */
function upgradeCandidates(preferred: EngineBackend, current: EngineBackend): EngineBackend[] {
  if (preferred === current) return []
  if (preferred === "cuda-13.4") return current === "cuda-12.4" ? [] : ["cuda-13.4", "cuda-12.4"]
  if (preferred === "cuda-12.4") return ["cuda-12.4"]
  return []
}

function freePort() {
  return new Promise<number>((resolve, reject) => {
    const socket = createServer()
    socket.on("error", reject)
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address()
      const port = typeof address === "object" && address ? address.port : 0
      socket.close(() => (port ? resolve(port) : reject(new Error("no free port"))))
    })
  })
}
