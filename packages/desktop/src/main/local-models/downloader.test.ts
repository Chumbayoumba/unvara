import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { download, IntegrityError } from "./downloader"

const payload = new Uint8Array(3 * 1024 * 1024).map((_, index) => index % 251)
const sha256 = createHash("sha256").update(payload).digest("hex")
const state = { requests: [] as (string | null)[], cutAt: 0 }
let server: ReturnType<typeof Bun.serve>
let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "unvara-dl-"))
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const range = request.headers.get("range")
      state.requests.push(range)
      const start = range ? Number(range.match(/bytes=(\d+)-/)?.[1] ?? 0) : 0
      // Simulate a dropped connection on the first full request.
      const end = state.cutAt && !range ? state.cutAt : payload.length
      const body = payload.slice(start, end)
      const headers = { "content-length": String(state.cutAt && !range ? payload.length - start : body.length) }
      return new Response(body, { status: range ? 206 : 200, headers })
    },
  })
})

afterAll(() => {
  server.stop(true)
  rmSync(dir, { recursive: true, force: true })
})

describe("download", () => {
  test("downloads and verifies sha256", async () => {
    state.cutAt = 0
    const dest = join(dir, "a.bin")
    const result = await download({ url: `${server.url}a`, dest, sha256, size: payload.length, retries: 0 })
    expect(result.sha256).toBe(sha256)
    expect(readFileSync(dest).length).toBe(payload.length)
  })

  test("resumes a dropped transfer with a Range request", async () => {
    state.cutAt = 1024 * 1024
    state.requests = []
    const dest = join(dir, "b.bin")
    const result = await download({ url: `${server.url}b`, dest, sha256, size: payload.length, retries: 2, retryDelay: 10 })
    expect(result.sha256).toBe(sha256)
    expect(state.requests[0]).toBeNull()
    expect(state.requests[1]).toBe(`bytes=${1024 * 1024}-`)
  })

  test("rejects a corrupted file", async () => {
    state.cutAt = 0
    const dest = join(dir, "c.bin")
    writeFileSync(`${dest}.part`, "")
    const bad = "0".repeat(64)
    await expect(download({ url: `${server.url}c`, dest, sha256: bad, retries: 3, retryDelay: 10 })).rejects.toBeInstanceOf(
      IntegrityError,
    )
  })
})
