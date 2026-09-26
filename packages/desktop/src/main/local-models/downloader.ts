import { execFile } from "node:child_process"
import { createHash, type Hash } from "node:crypto"
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname } from "node:path"

export type DownloadRequest = {
  url: string
  dest: string
  /** Expected size in bytes, when known (HF `files_metadata`, engine manifest). */
  size?: number
  /** Expected lowercase hex sha256; the file is deleted on mismatch. */
  sha256?: string
  headers?: Record<string, string>
  signal?: AbortSignal
  onProgress?: (received: number, total: number | undefined) => void
  /** Injected so it works with Electron's proxy-aware `net.fetch` and with plain fetch in tests. */
  fetch?: Fetcher
  retries?: number
  /** Base of the exponential backoff between retries (default 1 s). */
  retryDelay?: number
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

type PartMeta = { url: string; size?: number; sha256?: string; etag?: string }

const PROGRESS_INTERVAL = 250

/**
 * Resumable download into `<dest>.part` (+ `<dest>.part.json` describing what is being fetched).
 * Resume sends `Range: bytes=n-` and only continues on a 206; anything else restarts from zero.
 * The hash is computed while streaming (the existing partial is re-hashed first) so there is no second pass.
 */
export async function download(request: DownloadRequest) {
  const attempts = (request.retries ?? 4) + 1
  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptDownload(request)
    } catch (error) {
      if (request.signal?.aborted || attempt >= attempts || error instanceof IntegrityError) throw error
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, (request.retryDelay ?? 1000) * 2 ** attempt)))
    }
  }
}

export class IntegrityError extends Error {}

/** Unpacks a downloaded .zip or .tar archive into `dir`. */
export function extract(archive: string, dir: string) {
  return new Promise<void>((resolve, reject) => {
    // Windows 10+ ships bsdtar, which reads zip archives.
    execFile("tar", ["-xf", archive, "-C", dir], { windowsHide: true }, (error) => (error ? reject(error) : resolve()))
  })
}

async function attemptDownload(request: DownloadRequest) {
  const part = `${request.dest}.part`
  const metaFile = `${part}.json`
  const fetcher = request.fetch ?? fetch
  mkdirSync(dirname(request.dest), { recursive: true })

  const meta = readMeta(metaFile)
  const sameSource = meta?.url === request.url && meta?.sha256 === request.sha256
  if (!sameSource) rmSync(part, { force: true })
  const existing = sameSource && existsSync(part) ? statSync(part).size : 0

  const response = await fetcher(request.url, {
    headers: { ...request.headers, ...(existing > 0 ? { range: `bytes=${existing}-` } : {}) },
    signal: request.signal,
  })
  if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status} ${request.url}`)
  const resumed = existing > 0 && response.status === 206
  const offset = resumed ? existing : 0
  const length = Number(response.headers.get("content-length") ?? NaN)
  const total = request.size ?? (Number.isFinite(length) ? offset + length : undefined)
  writeFileSync(
    metaFile,
    JSON.stringify({
      url: request.url,
      size: total,
      sha256: request.sha256,
      etag: response.headers.get("etag") ?? undefined,
    } satisfies PartMeta),
  )

  const hash = createHash("sha256")
  if (resumed) await hashFile(part, hash)
  const out = createWriteStream(part, { flags: resumed ? "a" : "w" })
  const state = { received: offset, reported: 0 }
  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      hash.update(chunk)
      if (!out.write(chunk)) await new Promise<void>((resolve) => out.once("drain", () => resolve()))
      state.received += chunk.byteLength
      const now = Date.now()
      if (now - state.reported >= PROGRESS_INTERVAL) {
        state.reported = now
        request.onProgress?.(state.received, total)
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())))
  }
  request.onProgress?.(state.received, total)

  if (total !== undefined && state.received !== total)
    throw new Error(`incomplete download: ${state.received}/${total}`)
  const digest = hash.digest("hex")
  if (request.sha256 && digest !== request.sha256.toLowerCase()) {
    rmSync(part, { force: true })
    rmSync(metaFile, { force: true })
    throw new IntegrityError(`sha256 mismatch for ${request.url}: ${digest}`)
  }
  rmSync(request.dest, { force: true })
  renameSync(part, request.dest)
  rmSync(metaFile, { force: true })
  return { path: request.dest, size: state.received, sha256: digest }
}

async function hashFile(file: string, hash: Hash) {
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer)
}

function readMeta(file: string): PartMeta | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as PartMeta
  } catch {
    return undefined
  }
}
