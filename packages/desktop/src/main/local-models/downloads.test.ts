import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createDownloadQueue } from "./downloads"

const CHUNK = 64 * 1024
const payload = new Uint8Array(2 * 1024 * 1024).map((_, index) => index % 251)
const sha256 = createHash("sha256").update(payload).digest("hex")
let server: ReturnType<typeof Bun.serve>
let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "unvara-queue-"))
  // Streams slowly (~0.6 s per file) so a test can pause or cancel mid-transfer.
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const start = Number(request.headers.get("range")?.match(/bytes=(\d+)-/)?.[1] ?? 0)
      const cursor = { at: start }
      const body = new ReadableStream({
        async pull(controller) {
          if (cursor.at >= payload.length) return controller.close()
          await Bun.sleep(20)
          controller.enqueue(payload.slice(cursor.at, cursor.at + CHUNK))
          cursor.at += CHUNK
        },
      })
      return new Response(body, {
        status: start ? 206 : 200,
        headers: { "content-length": String(payload.length - start) },
      })
    },
  })
})

afterAll(() => {
  server.stop(true)
  rmSync(dir, { recursive: true, force: true })
})

function setup(name: string, inUse: (path: string) => boolean = () => false) {
  const root = join(dir, name)
  const installed: string[] = []
  const queue = createDownloadQueue({
    file: join(root, "downloads.json"),
    fetch: (url, init) => fetch(url, init),
    log: () => {},
    onChange: () => {},
    install: async (job) => {
      installed.push(job.id)
    },
    inUse,
  })
  const files = ["model.gguf", "mmproj.gguf"].map((file) => ({
    url: `${server.url}${file}`,
    dest: join(root, "models", file),
    size: payload.length,
    sha256,
  }))
  const job = { id: "model@Q4_K_M", catalogId: "model", quant: "Q4_K_M", name: "Model", files }
  return { queue, job, files, installed, current: () => queue.jobs().find((item) => item.id === job.id) }
}

async function until(check: () => boolean, timeout = 10_000) {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error("timed out")
    await Bun.sleep(10)
  }
}

describe("download queue", () => {
  test("downloads every file, then installs", async () => {
    const run = setup("full")
    run.queue.add(run.job)
    await until(() => run.current()?.status === "done")
    expect(run.installed).toEqual(["model@Q4_K_M"])
    expect(run.current()?.received).toBe(payload.length * 2)
    run.files.forEach((file) => expect(readFileSync(file.dest).length).toBe(payload.length))
  })

  test("pause keeps the partial file and resume finishes from it", async () => {
    const run = setup("pause")
    run.queue.add(run.job)
    await until(() => (run.current()?.received ?? 0) > CHUNK * 4)
    run.queue.pause(run.job.id)
    expect(run.current()?.status).toBe("paused")
    expect(existsSync(`${run.files[0].dest}.part`)).toBe(true)
    run.queue.resume(run.job.id)
    await until(() => run.current()?.status === "done")
    expect(readFileSync(run.files[0].dest).length).toBe(payload.length)
  })

  test("cancel removes partial files but never a file an installed model uses", async () => {
    const run = setup("cancel", (path) => path.endsWith("mmproj.gguf"))
    // The projector is already installed (shared with another quant), so the queue skips it.
    mkdirSync(join(dir, "cancel", "models"), { recursive: true })
    writeFileSync(run.files[1].dest, payload)
    run.queue.add({ ...run.job, files: run.files.toReversed() })
    await until(() => (run.current()?.received ?? 0) > payload.length + CHUNK * 2)
    run.queue.cancel(run.job.id)
    expect(run.current()).toBeUndefined()
    await until(() => !existsSync(`${run.files[0].dest}.part`))
    expect(readFileSync(run.files[1].dest).length).toBe(payload.length)
  })

  test("jobs interrupted by quitting go back into the queue", () => {
    const file = join(dir, "restart.json")
    writeFileSync(file, JSON.stringify({ version: 1, jobs: [{ id: "a@Q4_K_M", status: "downloading", speed: 5, files: [] }] }))
    const queue = createDownloadQueue({
      file,
      fetch: (url, init) => fetch(url, init),
      log: () => {},
      onChange: () => {},
      install: async () => {},
      inUse: () => false,
    })
    expect(queue.jobs()[0]).toMatchObject({ status: "queued", speed: 0 })
  })
})
