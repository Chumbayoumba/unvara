import { open, readdir, readFile, stat } from "node:fs/promises"
import os from "node:os"
import { basename, dirname, join, relative, sep } from "node:path"
import type { ImportSource } from "@opencode-ai/app/local-models/types"
import { readGgufMetadataWith } from "@opencode-ai/app/local-models/gguf"
import { isAuxiliaryGguf } from "@opencode-ai/app/local-models/quant"

export type FoundModel = {
  /** First shard for split models. */
  path: string
  /** Bytes of all shards. */
  size: number
  /** Set when the store names models itself (Ollama's "qwen3:4b"); otherwise the file name is used. */
  name?: string
  mmproj?: { path: string; size: number }
  metadata: Record<string, unknown>
}

// LM Studio keeps models in publisher/repo folders; a few levels more covers hand-made layouts.
const MAX_DEPTH = 5
const SHARD = /-(\d{5})-of-(\d{5})\.gguf$/i

/** Folders where other apps keep GGUF models, if they exist on this PC. */
export async function importSources(): Promise<ImportSource[]> {
  const home = os.homedir()
  const candidates: ImportSource[] = [
    { app: "lmstudio", path: join(home, ".lmstudio", "models") },
    { app: "lmstudio", path: join(home, ".cache", "lm-studio", "models") },
    { app: "ollama", path: process.env.OLLAMA_MODELS ?? join(home, ".ollama", "models") },
  ]
  const found = await Promise.all(
    candidates.map(async (source) =>
      (await stat(source.path).catch(() => undefined))?.isDirectory() ? source : undefined,
    ),
  )
  return found.filter((source) => source !== undefined)
}

/**
 * GGUF models under `root`, used in place: the first shard of split files, paired with a vision projector
 * from the same folder. Unreadable or non-model files are skipped.
 */
export async function findModels(root: string, log: (message: string, extra?: Record<string, unknown>) => void) {
  if ((await isDirectory(join(root, "manifests"))) && (await isDirectory(join(root, "blobs"))))
    return findOllamaModels(root, log)
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

/**
 * Ollama stores GGUF weights as content-addressed blobs; its manifests (manifests/<registry>/<namespace>/<model>/<tag>)
 * say which blob is the model and which the vision projector. Several tags can share one blob.
 */
async function findOllamaModels(root: string, log: (message: string, extra?: Record<string, unknown>) => void) {
  const manifests = join(root, "manifests")
  const found = await Promise.all(
    (await walk(manifests, 4)).map(async (file): Promise<FoundModel | undefined> => {
      const manifest = await readFile(file.path, "utf8")
        .then((text) => JSON.parse(text) as { layers?: { mediaType?: string; digest?: string; size?: number }[] })
        .catch(() => undefined)
      const blob = (mediaType: string) => {
        const layer = manifest?.layers?.find((item) => item.mediaType === mediaType)
        if (!layer?.digest) return
        return { path: join(root, "blobs", layer.digest.replace(":", "-")), size: layer.size ?? 0 }
      }
      const model = blob("application/vnd.ollama.image.model")
      if (!model) return
      const metadata = await readHeader(model.path).catch((error) => {
        log("skipping unreadable ollama blob", { path: model.path, error: String(error) })
        return undefined
      })
      if (!metadata || typeof metadata["general.architecture"] !== "string") return
      const [tag, name, namespace] = relative(manifests, file.path).split(sep).toReversed()
      return {
        ...model,
        name: namespace === "library" ? `${name}:${tag}` : `${namespace}/${name}:${tag}`,
        mmproj: blob("application/vnd.ollama.image.projector"),
        metadata,
      }
    }),
  )
  return found
    .filter((item) => item !== undefined)
    .filter((item, index, all) => all.findIndex((other) => other.path === item.path) === index)
}

async function isDirectory(path: string) {
  return (await stat(path).catch(() => undefined))?.isDirectory() ?? false
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
