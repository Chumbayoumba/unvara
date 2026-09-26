import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { app } from "electron"
import type { EngineBackend, GpuInfo } from "@opencode-ai/app/local-models/types"
import manifest from "../../../engine.manifest.json"

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

/** Best backend that is already on disk; CUDA provisioning (M2b) extends this with downloads. */
export function installedBackend(localRoot: string, gpu: GpuInfo | undefined): EngineBackend {
  const order: EngineBackend[] = gpu ? ["cuda-13.4", "cuda-12.4", "vulkan", "cpu"] : ["cpu"]
  return order.find((backend) => isInstalled(localRoot, backend) && supports(backend, gpu)) ?? "cpu"
}

function supports(backend: EngineBackend, gpu: GpuInfo | undefined) {
  if (!backend.startsWith("cuda")) return true
  return gpu?.vendor === "nvidia"
}
