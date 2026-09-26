import { open, readdir, stat } from "node:fs/promises"
import os from "node:os"
import { basename, dirname, join } from "node:path"
import { readGgufMetadataWith } from "@opencode-ai/app/local-models/gguf"
import { isAuxiliaryGguf } from "@opencode-ai/app/local-models/quant"

export type FoundModel = {
  /** First shard for split models. */
  path: string
  /** Bytes of all shards. */
  size: number
  mmproj?: { path: string; size: number }
  metadata: Record<string, unknown>
}

// LM Studio keeps models in publisher/repo folders; a few levels more covers hand-made layouts.
const MAX_DEPTH = 5
const SHARD = /-(\d{5})-of-(\d{5})\.gguf$/i

/** Folders where other apps keep GGUF models, if they exist on this PC. */
export async function importSources() {
  const home = os.homedir()
  const candidates = [join(home, ".lmstudio", "models"), join(home, ".cache", "lm-studio", "models")]
  const found = await Promise.all(
    candidates.map(async (dir) => ((await stat(dir).catch(() => undefined))?.isDirectory() ? dir : undefined)),
  )
  return found.filter((dir) => dir !== undefined)
}

/**
 * GGUF models under `root`, used in place: the first shard of split files, paired with a vision projector
 * from the same folder. Unreadable or non-model files are skipped.
 */
export async function findModels(root: string, log: (message: string, extra?: Record<string, unknown>) => void) {
  const files = await walk(root, MAX_DEPTH)
  const ggufs = files.filter(
    (file) => file.path.toLowerCase().endsWith(".gguf") && !isAuxiliaryGguf(basename(file.path)),
  )
  const projectors = ggufs.filter((file) => /mmproj/i.test(basename(file.path)))
  const weights = ggufs.filter((file) => {
    if (/mmproj/i.test(basename(file.path))) return false
    const shard = file.path.match(SHARD)
    return !shard || Number(shard[1]) === 1
  })
  const found = await Promise.all(
    weights.map(async (file): Promise<FoundModel | undefined> => {
      const metadata = await readHeader(file.path).catch((error) => {
        log("skipping unreadable gguf", { path: file.path, error: String(error) })
        return undefined
      })
      if (!metadata || typeof metadata["general.architecture"] !== "string") return undefined
      const prefix = file.path.replace(SHARD, "")
      const shards = file.path.match(SHARD) ? files.filter((item) => item.path.replace(SHARD, "") === prefix) : [file]
      const mmproj = projectors.find((item) => dirname(item.path) === dirname(file.path))
      return { path: file.path, size: shards.reduce((sum, item) => sum + item.size, 0), mmproj, metadata }
    }),
  )
  return found.filter((item) => item !== undefined)
}

async function walk(dir: string, depth: number): Promise<{ path: string; size: number }[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return depth > 0 ? walk(path, depth - 1) : []
      if (!entry.isFile()) return []
      return [{ path, size: (await stat(path)).size }]
    }),
  )
  return nested.flat()
}

async function readHeader(path: string) {
  const handle = await open(path, "r")
  return readGgufMetadataWith(async (offset, length) => {
    const buffer = new Uint8Array(length)
    const result = await handle.read(buffer, 0, length, offset)
    return buffer.subarray(0, result.bytesRead)
  }).finally(() => handle.close())
}
