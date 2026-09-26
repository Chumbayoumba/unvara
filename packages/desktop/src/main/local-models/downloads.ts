import { existsSync, mkdirSync, rmSync, statfsSync, statSync } from "node:fs"
import { dirname } from "node:path"
import type { DownloadError, DownloadFile, DownloadJob } from "@opencode-ai/app/local-models/types"
import { download, IntegrityError, type Fetcher } from "./downloader"
import { readText, writeAtomic } from "./presets"

type Logger = (message: string, extra?: Record<string, unknown>, level?: "info" | "warn" | "error") => void

// Keep some room on the drive after the download so Windows and the pagefile don't run dry.
const SPARE_SPACE = 1024 ** 3

/**
 * Model download queue: one job at a time, in order. Jobs live in `downloads.json`, so a download cut off by
 * quitting resumes from its `.part` files on the next launch.
 */
export function createDownloadQueue(options: {
  file: string
  fetch: Fetcher
  log: Logger
  onChange: (jobs: DownloadJob[]) => void
  /** Registers the finished files as a model; a failure marks the job failed. */
  install: (job: DownloadJob) => Promise<void>
  /** Files an installed model already uses (e.g. a projector shared by two quants) are never discarded. */
  inUse: (path: string) => boolean
}) {
  const jobs = readJobs(options.file)
  const active = { job: undefined as DownloadJob | undefined, controller: undefined as AbortController | undefined }

  function changed(persist = true) {
    if (persist) writeAtomic(options.file, JSON.stringify({ version: 1, jobs }, null, 2))
    options.onChange(jobs.map((job) => ({ ...job })))
  }

  function add(job: Pick<DownloadJob, "id" | "catalogId" | "quant" | "name" | "files">) {
    const existing = jobs.find((item) => item.id === job.id)
    if (existing?.status === "done") jobs.splice(jobs.indexOf(existing), 1)
    if (existing && existing.status !== "done") {
      resume(existing.id)
      return existing.id
    }
    const total = job.files.reduce((sum, file) => sum + file.size, 0)
    jobs.push({ ...job, total, received: 0, speed: 0, status: "queued", createdAt: Date.now() })
    changed()
    pump()
    return job.id
  }

  function pause(id: string) {
    const job = jobs.find((item) => item.id === id)
    if (job?.status !== "queued" && job?.status !== "downloading") return
    Object.assign(job, { status: "paused", speed: 0 })
    if (active.job === job) active.controller?.abort()
    changed()
  }

  function resume(id: string) {
    const job = jobs.find((item) => item.id === id)
    if (job?.status !== "paused" && job?.status !== "failed") return
    Object.assign(job, { status: "queued", error: undefined })
    changed()
    pump()
  }

  function cancel(id: string) {
    const job = jobs.find((item) => item.id === id)
    if (!job) return
    jobs.splice(jobs.indexOf(job), 1)
    changed()
    // A finished job only leaves the list; anything else takes its partial and unregistered files with it.
    if (job.status === "done") return
    // Windows can't delete the .part the active download still has open; run() discards it once stopped.
    if (active.job === job) return active.controller?.abort()
    discard(job, options.inUse)
  }

  function pump() {
    if (active.job) return
    const next = jobs.find((job) => job.status === "queued")
    if (next) void run(next)
  }

  async function run(job: DownloadJob) {
    const controller = new AbortController()
    Object.assign(active, { job, controller })
    try {
      ensureSpace(job.files)
      Object.assign(job, { status: "downloading", received: job.files.reduce((sum, file) => sum + onDisk(file), 0) })
      changed()
      const meter = { at: Date.now(), bytes: job.received }
      // Shards download one after another; a shard finished in an earlier session is kept as is.
      for (const [index, file] of job.files.entries()) {
        if (existsSync(file.dest) && statSync(file.dest).size === file.size) continue
        const before = job.files.slice(0, index).reduce((sum, item) => sum + item.size, 0)
        await download({
          url: file.url,
          dest: file.dest,
          size: file.size,
          sha256: file.sha256 || undefined,
          fetch: options.fetch,
          signal: controller.signal,
          onProgress: (received) => {
            const now = Date.now()
            const rate = ((before + received - meter.bytes) * 1000) / Math.max(1, now - meter.at)
            Object.assign(job, { received: before + received, speed: job.speed ? job.speed * 0.7 + rate * 0.3 : rate })
            Object.assign(meter, { at: now, bytes: job.received })
            changed(false)
          },
        })
      }
      Object.assign(job, { status: "installing", received: job.total, speed: 0 })
      changed()
      await options.install(job).catch((error) => {
        throw new QueueError("install", String(error))
      })
      job.status = "done"
      changed()
    } catch (error) {
      // Paused or cancelled: the caller already set the state.
      if (controller.signal.aborted) return
      Object.assign(job, { status: "failed", speed: 0, error: describe(error) })
      options.log("model download failed", { id: job.id, error: String(error) }, "error")
      changed()
    } finally {
      if (!jobs.includes(job) && job.status !== "done") discard(job, options.inUse)
      Object.assign(active, { job: undefined, controller: undefined })
      pump()
    }
  }

  return { add, pause, resume, cancel, start: pump, jobs: () => jobs.map((job) => ({ ...job })) }
}

export type DownloadQueue = ReturnType<typeof createDownloadQueue>

class QueueError extends Error {
  constructor(
    readonly code: "disk-full" | "install",
    message: string,
  ) {
    super(message)
  }
}

function readJobs(file: string): DownloadJob[] {
  const text = readText(file)
  const jobs = text ? ((JSON.parse(text) as { jobs?: DownloadJob[] }).jobs ?? []) : []
  // Whatever was running when the app quit goes back into the queue.
  return jobs.map((job) =>
    job.status === "downloading" || job.status === "installing" ? { ...job, status: "queued", speed: 0 } : job,
  )
}

function ensureSpace(files: DownloadFile[]) {
  const dir = dirname(files[0].dest)
  mkdirSync(dir, { recursive: true })
  const stats = statfsSync(dir)
  const free = stats.bavail * stats.bsize
  const missing = files.reduce((sum, file) => sum + file.size - onDisk(file), 0)
  if (free < missing + SPARE_SPACE) throw new QueueError("disk-full", `${missing} bytes needed, ${free} free in ${dir}`)
}

function onDisk(file: DownloadFile) {
  if (existsSync(file.dest)) return statSync(file.dest).size
  if (existsSync(`${file.dest}.part`)) return statSync(`${file.dest}.part`).size
  return 0
}

function discard(job: DownloadJob, inUse: (path: string) => boolean) {
  job.files
    .filter((file) => !inUse(file.dest))
    .forEach((file) =>
      [file.dest, `${file.dest}.part`, `${file.dest}.part.json`].forEach((path) => rmSync(path, { force: true })),
    )
}

function describe(error: unknown): DownloadError {
  const detail = error instanceof Error ? error.message : String(error)
  if (error instanceof IntegrityError) return { code: "integrity", detail }
  if (error instanceof QueueError) return { code: error.code, detail }
  return { code: "network", detail }
}
