import { describe, expect, test } from "bun:test"
import { kvBytes } from "./fit"
import { ggufShape, parseGgufMetadata, readGgufMetadata } from "./gguf"

type Value = string | number | boolean | { u8: number[] } | Value[]

// Encodes a GGUF v3 header with the given metadata (strings, u32 numbers, bools, arrays of those, raw u8 arrays).
function encode(metadata: Record<string, Value>) {
  const parts: Uint8Array[] = []
  const u32 = (value: number) => parts.push(new Uint8Array(new Uint32Array([value]).buffer))
  const u64 = (value: number) => parts.push(new Uint8Array(new BigUint64Array([BigInt(value)]).buffer))
  const string = (value: string) => {
    const bytes = new TextEncoder().encode(value)
    u64(bytes.byteLength)
    parts.push(bytes)
  }
  const type = (value: Value): number => {
    if (typeof value === "string") return 8
    if (typeof value === "boolean") return 7
    if (typeof value === "number") return 4
    return 9
  }
  const write = (value: Value) => {
    if (typeof value === "string") return string(value)
    if (typeof value === "boolean") return parts.push(new Uint8Array([value ? 1 : 0]))
    if (typeof value === "number") return u32(value)
    if (!Array.isArray(value)) {
      u32(0)
      u64(value.u8.length)
      return parts.push(new Uint8Array(value.u8))
    }
    u32(value.length ? type(value[0]) : 4)
    u64(value.length)
    value.forEach(write)
  }
  u32(0x46554747)
  u32(3)
  u64(0)
  u64(Object.keys(metadata).length)
  for (const [key, value] of Object.entries(metadata)) {
    string(key)
    u32(type(value))
    write(value)
  }
  return new Uint8Array(Buffer.concat(parts))
}

const gemmaPattern = (layers: number) => Array.from({ length: layers }, (_, index) => index % 6 < 5)

describe("parseGgufMetadata", () => {
  test("reads scalars, strings and arrays and skips huge ones", () => {
    const metadata = parseGgufMetadata(
      encode({
        "general.architecture": "qwen3",
        "qwen3.block_count": 36,
        "qwen3.attention.head_count_kv": [8, 8],
        "tokenizer.ggml.token_type": { u8: Array(5000).fill(1) },
        "general.flag": true,
      }),
    )
    expect(metadata["general.architecture"]).toBe("qwen3")
    expect(metadata["qwen3.block_count"]).toBe(36)
    expect(metadata["qwen3.attention.head_count_kv"]).toEqual([8, 8])
    expect(metadata["tokenizer.ggml.token_type"]).toEqual({ skipped: 5000 })
    expect(metadata["general.flag"]).toBe(true)
  })

  test("rejects files that are not GGUF", () => {
    expect(() => parseGgufMetadata(new Uint8Array(64))).toThrow("not a GGUF file")
  })
})

describe("readGgufMetadata", () => {
  // Metadata larger than the first 4 MB request forces a second, bigger range read.
  const file = encode({
    "general.architecture": "llama",
    "tokenizer.ggml.scores": { u8: Array(6 * 1024 * 1024).fill(0) },
    "llama.block_count": 28,
  })
  const ranges: string[] = []
  // The app test env replaces global fetch with happy-dom's, so serve the ranges through the fetch option.
  const fetchRange = async (_url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get("range") ?? ""
    ranges.push(range)
    const [start, end] = range.replace("bytes=", "").split("-").map(Number)
    return new Response(file.slice(start, end + 1), { status: 206 })
  }

  test("fetches the header incrementally over Range requests", async () => {
    const metadata = await readGgufMetadata("https://example.test/model.gguf", { fetch: fetchRange })
    expect(metadata["llama.block_count"]).toBe(28)
    expect(ranges).toEqual(["bytes=0-4194303", "bytes=4194304-12582911"])
  })
})

describe("ggufShape", () => {
  const params = { total: 12e9 }

  test("Gemma 4 12B: global layers with 1 KV head of 512, sliding layers with 8 of 256", () => {
    const shape = ggufShape(
      {
        "general.architecture": "gemma4",
        "gemma4.block_count": 48,
        "gemma4.context_length": 262144,
        "gemma4.attention.head_count": 16,
        "gemma4.attention.head_count_kv": Array.from({ length: 48 }, (_, index) => (index % 6 === 5 ? 1 : 8)),
        "gemma4.attention.key_length": 512,
        "gemma4.attention.value_length": 512,
        "gemma4.attention.key_length_swa": 256,
        "gemma4.attention.value_length_swa": 256,
        "gemma4.attention.sliding_window": 1024,
        "gemma4.attention.sliding_window_pattern": gemmaPattern(48),
      },
      params,
    )
    expect(shape).toMatchObject({ layers: 48, fullAttentionLayers: 8, headCountKv: 1, keyLength: 512, contextMax: 262144 })
    expect(shape.swa).toEqual({ layers: 40, window: 1024, headCountKv: 8, keyLength: 256, valueLength: 256 })
  })

  test("Gemma 4 E4B: layers that share another layer's cache own none", () => {
    const shape = ggufShape(
      {
        "general.architecture": "gemma4",
        "gemma4.block_count": 42,
        "gemma4.attention.head_count": 8,
        "gemma4.attention.head_count_kv": 2,
        "gemma4.attention.key_length": 512,
        "gemma4.attention.sliding_window": 512,
        "gemma4.attention.shared_kv_layers": 18,
        "gemma4.attention.sliding_window_pattern": gemmaPattern(42),
      },
      params,
    )
    expect(shape.fullAttentionLayers).toBe(4)
    expect(shape.swa?.layers).toBe(20)
  })

  test("gpt-oss: llama.cpp's hardcoded alternating window", () => {
    const shape = ggufShape(
      {
        "general.architecture": "gpt-oss",
        "gpt-oss.block_count": 24,
        "gpt-oss.attention.head_count": 64,
        "gpt-oss.attention.head_count_kv": 8,
        "gpt-oss.attention.key_length": 64,
        "gpt-oss.attention.value_length": 64,
        "gpt-oss.attention.sliding_window": 128,
      },
      params,
    )
    expect(shape.fullAttentionLayers).toBe(12)
    expect(shape.swa).toEqual({ layers: 12, window: 128, headCountKv: 8, keyLength: 64, valueLength: 64 })
    // 32k context: 12 global layers hold every token, 12 sliding ones only the window plus a micro-batch.
    expect(kvBytes(shape, 32768, "f16")).toBe(12 * 8 * 128 * 2 * 32768 + 12 * 8 * 128 * 2 * (128 + 512))
  })

  test("Qwen3.5+ hybrid: only every Nth layer keeps a KV cache", () => {
    const shape = ggufShape(
      {
        "general.architecture": "qwen35moe",
        "qwen35moe.block_count": 40,
        "qwen35moe.attention.head_count": 16,
        "qwen35moe.attention.head_count_kv": 2,
        "qwen35moe.attention.key_length": 256,
        "qwen35moe.full_attention_interval": 4,
      },
      params,
    )
    expect(shape).toMatchObject({ fullAttentionLayers: 10, headCountKv: 2, swa: undefined })
  })

  test("DeepSeek V4: compressed layers count as a fraction of a full one", () => {
    const shape = ggufShape(
      {
        "general.architecture": "deepseek4",
        "deepseek4.block_count": 6,
        "deepseek4.attention.head_count": 64,
        "deepseek4.attention.head_count_kv": 1,
        "deepseek4.attention.key_length": 512,
        "deepseek4.attention.compress_ratios": [0, 4, 4, 4, 4, 128],
        "deepseek4.attention.sliding_window": 128,
      },
      params,
    )
    expect(shape.fullAttentionLayers).toBe(Math.ceil(1 + 4 / 4 + 1 / 128))
    expect(shape.swa).toBeUndefined()
  })
})
