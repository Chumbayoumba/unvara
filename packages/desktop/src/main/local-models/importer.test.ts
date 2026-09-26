import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { findModels } from "./importer"

let dir: string

// Smallest valid GGUF v3 header: magic, version, no tensors, string metadata only.
function gguf(metadata: Record<string, string>) {
  const parts: Uint8Array[] = []
  const u32 = (value: number) => parts.push(new Uint8Array(new Uint32Array([value]).buffer))
  const u64 = (value: number) => parts.push(new Uint8Array(new BigUint64Array([BigInt(value)]).buffer))
  const string = (value: string) => {
    const bytes = new TextEncoder().encode(value)
    u64(bytes.byteLength)
    parts.push(bytes)
  }
  u32(0x46554747)
  u32(3)
  u64(0)
  u64(Object.keys(metadata).length)
  Object.entries(metadata).forEach(([key, value]) => {
    string(key)
    u32(8)
    string(value)
  })
  return Buffer.concat(parts)
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "unvara-import-"))
  const model = gguf({ "general.architecture": "llama" })
  mkdirSync(join(dir, "publisher", "vision"), { recursive: true })
  mkdirSync(join(dir, "publisher", "split"), { recursive: true })
  writeFileSync(join(dir, "publisher", "vision", "model-Q4_K_M.gguf"), model)
  writeFileSync(join(dir, "publisher", "vision", "mmproj-model-f16.gguf"), gguf({ "general.architecture": "clip" }))
  writeFileSync(join(dir, "publisher", "split", "big-Q8_0-00001-of-00002.gguf"), model)
  writeFileSync(join(dir, "publisher", "split", "big-Q8_0-00002-of-00002.gguf"), Buffer.alloc(1000))
  writeFileSync(join(dir, "publisher", "split", "mtp-big.gguf"), model)
  writeFileSync(join(dir, "broken.gguf"), "not a model")
  writeFileSync(join(dir, "notes.txt"), "hello")
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe("findModels", () => {
  test("finds models in place: first shard only, projector paired, drafts and broken files skipped", async () => {
    const found = (await findModels(dir, () => {})).toSorted((a, b) => a.path.localeCompare(b.path))
    expect(found.map((item) => item.path.slice(dir.length + 1).replaceAll("\\", "/"))).toEqual([
      "publisher/split/big-Q8_0-00001-of-00002.gguf",
      "publisher/vision/model-Q4_K_M.gguf",
    ])
    const header = gguf({ "general.architecture": "llama" }).length
    expect(found[0].size).toBe(header + 1000)
    expect(found[0].mmproj).toBeUndefined()
    expect(found[1].mmproj?.path).toEndWith("mmproj-model-f16.gguf")
    expect(found[1].metadata["general.architecture"]).toBe("llama")
  })
})

describe("findModels in an Ollama store", () => {
  test("names models by manifest, finds the projector layer and lists a shared blob once", async () => {
    const store = join(dir, "ollama")
    const blobs = join(store, "blobs")
    const tags = join(store, "manifests", "registry.ollama.ai", "library", "qwen3")
    mkdirSync(blobs, { recursive: true })
    mkdirSync(tags, { recursive: true })
    writeFileSync(join(blobs, "sha256-aaa"), gguf({ "general.architecture": "qwen3" }))
    writeFileSync(join(blobs, "sha256-bbb"), gguf({ "general.architecture": "clip" }))
    const layers = [
      { mediaType: "application/vnd.ollama.image.model", digest: "sha256:aaa", size: 123 },
      { mediaType: "application/vnd.ollama.image.projector", digest: "sha256:bbb", size: 45 },
    ]
    ;["4b", "latest"].forEach((tag) => writeFileSync(join(tags, tag), JSON.stringify({ schemaVersion: 2, layers })))

    const found = await findModels(store, () => {})
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ size: 123, mmproj: { size: 45 } })
    expect(["qwen3:4b", "qwen3:latest"]).toContain(found[0].name!)
    expect(found[0].path).toEndWith("sha256-aaa")
  })
})
