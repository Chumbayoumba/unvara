import { execFile } from "node:child_process"
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { app } from "electron"
import type { EngineBackend, GpuInfo } from "@opencode-ai/app/local-models/types"
import manifest from "../../../engine.manifest.json"
import { download, type Fetcher } from "./downloader"

const root = dirname(fileURLToPath(import.meta.url))

export const ENGINE_BUILD = manifest.build

/** Backends shipped inside the installer (CPU + Vulkan) live in resources/engine/<backend>. */
export function bundledEngineDir(backend: EngineBackend) {
  return app.isPackaged
    ? join(process.resourcesPath, "engine", backend)
    : join(root, "../../resources/engine", backend)
}

/** Downloaded backends (CUDA) live next to the models' engine data, versioned by build. */
export function downloadedEngineDir(localRoot: string, backend: EngineBackend) {
  return join(localRoot, "engine", "builds", ENGINE_BUILD, backend)
}

export function engineDir(localRoot: string, backend: EngineBackend) {
  const bundled = bundledEngineDir(backend)
  if (existsSync(join(bundled, "llama-server.exe"))) return bundled
  return downloadedEngineDir(localRoot, backend)
}

export function isInstalled(localRoot: string, backend: EngineBackend) {
  return existsSync(join(engineDir(localRoot, backend), "llama-server.exe"))
}

/** Best backend that is already on disk and suits the GPU. */
export function installedBackend(localRoot: string, gpu: GpuInfo | undefined): EngineBackend {
  const order: EngineBackend[] = gpu ? ["cuda-13.4", "cuda-12.4", "vulkan", "cpu"] : ["cpu"]
  return order.find((backend) => isInstalled(localRoot, backend) && supports(backend, gpu)) ?? "cpu"
}

/**
 * Fastest backend this machine should run. CUDA 13 dropped GPUs below compute capability 7.5 and needs driver
 * ≥ 580; CUDA 12.4 needs ≥ 551.61. Everything else (AMD, Intel, old drivers) uses Vulkan; no GPU means CPU.
 */
export function preferredBackend(gpu: GpuInfo | undefined): EngineBackend {
  if (!gpu) return "cpu"
  if (gpu.vendor !== "nvidia") return "vulkan"
  const driver = Number.parseFloat(gpu.driver ?? "")
  const cap = gpu.computeCap ?? 0
  if (!Number.isFinite(driver) || driver > 1000) return "vulkan" // registry format: nvidia-smi was unavailable
  if (cap >= Number(manifest.backends["cuda-13.4"].minComputeCap) && driver >= Number(manifest.backends["cuda-13.4"].minDriver)) return "cuda-13.4"
  if (cap >= Number(manifest.backends["cuda-12.4"].minComputeCap) && driver >= Number(manifest.backends["cuda-12.4"].minDriver)) return "cuda-12.4"
  return "vulkan"
}

/** Downloads, verifies (sha256) and unpacks a backend that is not bundled with the installer. */
export async function provisionBackend(
  localRoot: string,
  backend: EngineBackend,
  options: { fetch?: Fetcher; signal?: AbortSignal; onProgress?: (received: number, total: number) => void },
) {
  const archives = manifest.backends[backend].archives
  const total = archives.reduce((sum, archive) => sum + archive.size, 0)
  const done = { bytes: 0 }
  const target = downloadedEngineDir(localRoot, backend)
  const staging = `${target}.staging`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  for (const archive of archives) {
    const file = join(localRoot, "engine", "downloads", basename(new URL(archive.url).pathname))
    await download({
      url: archive.url,
      dest: file,
      size: archive.size,
      sha256: archive.sha256,
      fetch: options.fetch,
      signal: options.signal,
      onProgress: (received) => options.onProgress?.(done.bytes + received, total),
    })
    done.bytes += archive.size
    await extract(file, staging)
    rmSync(file, { force: true })
  }
  writeFileSync(join(staging, ".build"), ENGINE_BUILD)
  rmSync(target, { recursive: true, force: true })
  renameSync(staging, target)
  return target
}

function extract(archive: string, dir: string) {
  return new Promise<void>((resolve, reject) => {
    // Windows 10+ ships bsdtar, which reads zip archives.
    execFile("tar", ["-xf", archive, "-C", dir], { windowsHide: true }, (error) => (error ? reject(error) : resolve()))
  })
}

function supports(backend: EngineBackend, gpu: GpuInfo | undefined) {
  if (!backend.startsWith("cuda")) return true
  return gpu?.vendor === "nvidia"
}
