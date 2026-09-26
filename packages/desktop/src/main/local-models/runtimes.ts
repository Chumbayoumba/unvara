import { execFile } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs"
import { basename, join } from "node:path"
import manifest from "../../../runtimes.manifest.json"
import { download, extract, type Fetcher } from "./downloader"

/**
 * Runtimes for MCP connectors, which usually start with `npx` or `uvx`. Most people have neither, so Unvara installs
 * pinned bun and uv on demand; the OpenCode server finds them through UNVARA_RUNTIMES and runs connectors with them
 * (see connectorCommand in core). A real Node or uv on the PATH always wins.
 */
export type Runtime = keyof typeof manifest

const RUNTIME_FOR: Record<string, Runtime> = { npx: "bun", uvx: "uv" }

export function runtimesDir(localRoot: string) {
  return join(localRoot, "runtimes")
}

/** The runtime a connector command would need, or undefined when it needs none or the PC already has the tool. */
export async function neededRuntime(localRoot: string, command: string) {
  const runtime = RUNTIME_FOR[command]
  if (!runtime || isInstalled(localRoot, runtime) || (await onPath(command))) return
  return runtime
}

export async function installRuntime(
  localRoot: string,
  runtime: Runtime,
  options: { fetch?: Fetcher; onProgress?: (received: number, total: number) => void },
) {
  const entry = manifest[runtime]
  const dir = runtimesDir(localRoot)
  const archive = join(dir, "downloads", basename(new URL(entry.url).pathname))
  const staging = join(dir, `${runtime}.staging`)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  await download({
    url: entry.url,
    dest: archive,
    size: entry.size,
    sha256: entry.sha256,
    fetch: options.fetch,
    onProgress: (received) => options.onProgress?.(received, entry.size),
  })
  await extract(archive, staging)
  rmSync(archive, { force: true })
  // Archives nest differently (bun has a top folder, uv doesn't), so the executables are found by name.
  const extracted = readdirSync(staging, { recursive: true, encoding: "utf8" })
  entry.files.forEach((file) => {
    const found = extracted.find((item) => basename(item) === file)
    if (!found) throw new Error(`${file} missing from ${entry.url}`)
    renameSync(join(staging, found), join(dir, file))
  })
  rmSync(staging, { recursive: true, force: true })
}

function isInstalled(localRoot: string, runtime: Runtime) {
  return manifest[runtime].files.every((file) => existsSync(join(runtimesDir(localRoot), file)))
}

function onPath(command: string) {
  return new Promise<boolean>((resolve) =>
    execFile("where", [command], { windowsHide: true }, (error) => resolve(!error)),
  )
}
