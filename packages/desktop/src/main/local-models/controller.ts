import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync } from "node:fs"
import { createServer } from "node:net"
import { basename, isAbsolute, join } from "node:path"
import { net } from "electron"
import { downloadUrl, type Catalog } from "@opencode-ai/app/local-models/catalog"
import { hardwareProfile, planFit, primaryGpu } from "@opencode-ai/app/local-models/fit"
import { ggufShape } from "@opencode-ai/app/local-models/gguf"
import { AGENT_CONTEXT, agentReady } from "@opencode-ai/app/local-models/recommend"
import type {
  DownloadJob,
  EngineBackend,
  GpuInfo,
  LocalModel,
  LocalModelsSettings,
  LocalModelsState,
  SystemInfo,
} from "@opencode-ai/app/local-models/types"
import bundledCatalog from "../../../../../catalog/catalog.json"
import { localDataRoot } from "../paths"
import { createDownloadQueue } from "./downloads"
import { findModels, importSources } from "./importer"
import { ENGINE_BUILD, engineDir, installedBackend, isInstalled, preferredBackend, provisionBackend } from "./engine"
import { bestModelsDrive, detectSystem, listEngineDevices, pickDevice } from "./hardware"
import { readManifest, readText, writeAtomic, writeManifest, writePresets } from "./presets"
import { createRouter, type Router } from "./router"

// The snapshot shipped with this build; a signed remote copy will replace it once releases publish one.
const catalog = bundledCatalog as Catalog

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
    downloads: join(localRoot, "downloads.json"),
    settings: join(localRoot, "settings.json"),
  }
  const state: LocalModelsState = {
    engine: { status: "absent" },
    router: { status: "stopped" },
    models: readManifest(files.manifest).models,
    downloads: [],
    settings: readSettings(files.settings),
  }
  const queue = createDownloadQueue({
    file: files.downloads,
    fetch: net.fetch,
    log: options.log,
    onChange: (downloads) => emit({ downloads }),
    install,
    inUse: (path) => state.models.some((model) => [model.path, model.mmproj, ...(model.files ?? [])].includes(path)),
  })
  state.downloads = queue.jobs()
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
      gpus: system.gpus.map(
        (gpu) => `${gpu.name} ${(gpu.vram / 1024 ** 3).toFixed(1)}GB${gpu.integrated ? " (integrated)" : ""}`,
      ),
      ram: `${(system.ram.total / 1024 ** 3).toFixed(1)}GB total, ${(system.ram.available / 1024 ** 3).toFixed(1)}GB available, ${system.ram.bandwidth ?? "?"}GB/s`,
      cpu: `${system.cpu.name} x${system.cpu.cores}`,
      disks: system.disks.map((disk) => `${disk.letter}: ${disk.kind} ${(disk.free / 1e9).toFixed(0)}GB free`),
    })
    emit({ system })
    return system
  }

  async function start() {
    const system = await scanHardware()
    if (!state.settings.modelsDir) chooseModelsDir(system)
    // Downloads don't need the engine, so an interrupted one resumes even if the engine fails to start.
    queue.start()
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

  /** Writes the installed-models list and makes the router pick it up without a restart. */
  async function saveModels(models: LocalModel[]) {
    writeManifest(files.manifest, { version: 1, models })
    emit({ models })
    writePresets(files.presets, models, state.engine.status === "ready" ? state.engine.device : undefined)
    await runtime.router?.reload()
  }

  /** Queues a catalog model (all shards plus its vision projector); resolves with the job id. */
  async function download(catalogId: string, quant: string) {
    const model = catalog.models.find((item) => item.id === catalogId)
    const choice = model?.quants.find((item) => item.quant === quant)
    if (!model || !choice) throw new Error(`unknown catalog model ${catalogId}@${quant}`)
    const modelsDir = state.settings.modelsDir || chooseModelsDir(state.system ?? (await scanHardware()))
    // The projector goes last, so install() can tell it from the weights.
    const files = [...choice.files, ...(model.mmproj ? [model.mmproj] : [])].map((file) => ({
      url: downloadUrl(model.repo, file.name, state.settings.mirror),
      dest: join(modelsDir, ...model.repo.split("/"), ...file.name.split("/")),
      size: file.size,
      sha256: file.sha256,
    }))
    return queue.add({ id: `${catalogId}@${quant}`, catalogId, quant, name: model.name, files })
  }

  /** Registers finished files as a model, with the context this PC can hold at agent size. */
  async function install(job: DownloadJob) {
    const model = catalog.models.find((item) => item.id === job.catalogId)
    const choice = model?.quants.find((item) => item.quant === job.quant)
    if (!model || !choice) throw new Error(`unknown catalog model ${job.id}`)
    const system = state.system ?? (await scanHardware())
    const fit = planFit(
      model.shape,
      { size: choice.size, mmprojSize: model.mmproj?.size },
      hardwareProfile(system, preferredBackend(primaryGpu(system.gpus)), job.files[0].dest),
      { targetContext: AGENT_CONTEXT },
    )
    // A model that doesn't fit is still registered: llama.cpp's --fit may cope, and the UI shows the tier.
    const context = fit.mode === "none" ? Math.min(8192, model.contextMax) : fit.context
    const mmproj = model.mmproj ? job.files.at(-1)?.dest : undefined
    const id = `${model.id}-${job.quant.toLowerCase()}`
    await saveModels([
      ...state.models.filter((item) => item.id !== id),
      {
        id,
        name: `${model.name} ${job.quant}`,
        path: job.files[0].dest,
        mmproj,
        context,
        output: Math.min(8192, Math.floor(context / 4)),
        toolCall: model.capabilities.tools,
        agent: agentReady(model, fit),
        reasoning: model.capabilities.reasoning,
        vision: Boolean(mmproj),
        sampling: model.sampling,
        overrides: fit.kvType === "q8_0" ? { "cache-type-k": "q8_0", "cache-type-v": "q8_0" } : undefined,
        source: { catalogId: model.id, repo: model.repo, quant: job.quant },
        files: job.files.map((file) => file.dest),
        size: job.total,
        installedAt: Date.now(),
      },
    ])
    options.log("model installed", { id, context, kvType: fit.kvType, mode: fit.mode, tier: fit.tier })
  }

  /** Registers every GGUF model under `dir` in place (nothing is copied); resolves with how many it found. */
  async function importFolder(dir: string) {
    const found = await findModels(dir, options.log)
    const system = state.system ?? (await scanHardware())
    const hardware = hardwareProfile(system, preferredBackend(primaryGpu(system.gpus)), dir)
    const known = new Set(state.models.map((model) => model.path))
    const taken = new Set(state.models.map((model) => model.id))
    const added = found
      .filter((item) => !known.has(item.path))
      .map((item): LocalModel => {
        const metadata = item.metadata
        const arch = String(metadata["general.architecture"])
        const experts = Number(metadata[`${arch}.expert_count`] ?? 0)
        const used = Number(metadata[`${arch}.expert_used_count`] ?? 0)
        // The fit only needs the active/total ratio, so file bytes stand in for parameter counts.
        const shape = ggufShape(metadata, {
          total: item.size,
          active: experts && used ? item.size * (0.1 + (0.9 * used) / experts) : undefined,
        })
        const fit = planFit(shape, { size: item.size, mmprojSize: item.mmproj?.size }, hardware, {
          targetContext: AGENT_CONTEXT,
        })
        const context = fit.mode === "none" ? Math.min(8192, shape.contextMax) : fit.context
        const template = String(metadata["tokenizer.chat_template"] ?? "")
        const name = basename(item.path).replace(/(-\d{5}-of-\d{5})?\.gguf$/i, "")
        const id = uniqueId(
          name
            .toLowerCase()
            .replace(/[^a-z0-9.]+/g, "-")
            .replace(/^-|-$/g, ""),
          taken,
        )
        taken.add(id)
        return {
          id,
          name,
          path: item.path,
          mmproj: item.mmproj?.path,
          context,
          output: Math.min(8192, Math.floor(context / 4)),
          toolCall: /\btools\b/.test(template),
          reasoning: /<think>|reasoning/.test(template),
          vision: Boolean(item.mmproj),
          overrides: fit.kvType === "q8_0" ? { "cache-type-k": "q8_0", "cache-type-v": "q8_0" } : undefined,
          size: item.size + (item.mmproj?.size ?? 0),
          installedAt: Date.now(),
        }
      })
    if (added.length) await saveModels([...state.models, ...added])
    options.log("models imported", { dir, found: found.length, added: added.length })
    // Models registered earlier count too: they are all usable now.
    return found.length
  }

  async function removeModel(id: string) {
    const model = state.models.find((item) => item.id === id)
    if (!model) return
    // Windows can't delete a file llama.cpp still has mapped.
    if ("model" in state.router && state.router.model === id) await runtime.router?.unload(id)
    const models = state.models.filter((item) => item.id !== id)
    await saveModels(models)
    const kept = new Set(models.flatMap((item) => [item.path, item.mmproj, ...(item.files ?? [])]))
    ;(model.files ?? []).filter((file) => !kept.has(file)).forEach((file) => rmSync(file, { force: true }))
    if (model.source) queue.cancel(`${model.source.catalogId}@${model.source.quant}`)
  }

  function updateSettings(patch: Partial<LocalModelsSettings>) {
    const settings = { ...state.settings, ...patch }
    // llama.cpp on Windows opens files through the ANSI code page, so model folders must stay ASCII.
    if (
      patch.modelsDir !== undefined &&
      (!/^[\x20-\x7e]+$/.test(settings.modelsDir) || !isAbsolute(settings.modelsDir))
    )
      throw new Error(`models folder must be an absolute ASCII path: ${settings.modelsDir}`)
    writeAtomic(files.settings, JSON.stringify(settings, null, 2))
    emit({ settings })
    return settings
  }

  /** First run: the fastest drive with the most free space, at a short Latin path such as D:\Unvara\models. */
  function chooseModelsDir(system: SystemInfo) {
    const drive = bestModelsDrive(system.disks)
    const modelsDir =
      drive && process.platform === "win32" ? `${drive.letter}:\\Unvara\\models` : join(localRoot, "models")
    return updateSettings({ modelsDir }).modelsDir
  }

  return {
    prepare,
    start,
    scanHardware,
    download,
    importFolder,
    importSources,
    removeModel,
    updateSettings,
    getCatalog: () => catalog,
    pauseDownload: queue.pause,
    resumeDownload: queue.resume,
    cancelDownload: queue.cancel,
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

function uniqueId(base: string, taken: Set<string>) {
  const id = base || "model"
  if (!taken.has(id)) return id
  return Array.from({ length: taken.size + 1 }, (_, index) => `${id}-${index + 2}`).find((item) => !taken.has(item))!
}

function readSettings(file: string): LocalModelsSettings {
  const text = readText(file)
  return {
    modelsDir: "",
    mirror: "https://huggingface.co",
    ...(text ? (JSON.parse(text) as Partial<LocalModelsSettings>) : {}),
  }
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
