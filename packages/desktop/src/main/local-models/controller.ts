import { randomUUID } from "node:crypto"
import { mkdirSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import type { LocalModel, LocalModelsState } from "@opencode-ai/app/local-models/types"
import { localDataRoot } from "../paths"
import { ENGINE_BUILD, engineDir, installedBackend } from "./engine"
import { detectGpus, listEngineDevices, pickDevice, primaryGpu } from "./hardware"
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
    gpus: [],
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

  async function start() {
    const gpus = await detectGpus()
    const gpu = primaryGpu(gpus)
    const backend = installedBackend(localRoot, gpu)
    const binaryDir = engineDir(localRoot, backend)
    const device = backend === "cpu" ? undefined : pickDevice(await listEngineDevices(join(binaryDir, "llama-server.exe")), gpu)
    options.log("local engine selected", { backend, build: ENGINE_BUILD, gpu: gpu?.name, device: device?.id })
    emit({ gpus, engine: { status: "ready", backend, build: ENGINE_BUILD, device } })
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
