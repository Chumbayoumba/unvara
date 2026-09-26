/**
 * Minimal GGUF metadata reader over HTTP Range requests (no tensor data is downloaded).
 * Large arrays (tokenizer vocab, merges, scores) are skipped, not materialised.
 * Spec: https://github.com/ggml-org/ggml/blob/master/docs/gguf.md
 */

import type { ModelShape } from "./fit"

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>

const FIRST_CHUNK = 4 * 1024 * 1024
const MAX_BYTES = 96 * 1024 * 1024
const MAX_KEPT_ARRAY = 4096
// llama.cpp hardcodes the sliding-window layout of these archs: in every group of N layers the last one is global.
const SWA_PATTERN: Record<string, number> = { gemma2: 2, gemma3: 6, "gpt-oss": 2, cohere2: 4 }

const enum Type {
  U8 = 0,
  I8 = 1,
  U16 = 2,
  I16 = 3,
  U32 = 4,
  I32 = 5,
  F32 = 6,
  BOOL = 7,
  STRING = 8,
  ARRAY = 9,
  U64 = 10,
  I64 = 11,
  F64 = 12,
}

const SIZE: Partial<Record<Type, number>> = {
  [Type.U8]: 1,
  [Type.I8]: 1,
  [Type.BOOL]: 1,
  [Type.U16]: 2,
  [Type.I16]: 2,
  [Type.U32]: 4,
  [Type.I32]: 4,
  [Type.F32]: 4,
  [Type.U64]: 8,
  [Type.I64]: 8,
  [Type.F64]: 8,
}

class NeedMore extends Error {}

export async function readGgufMetadata(
  url: string,
  options: { fetch?: Fetcher; headers?: Record<string, string> } = {},
): Promise<Record<string, unknown>> {
  const fetcher = options.fetch ?? fetch
  return readGgufMetadataWith(async (offset, length) => {
    const response = await fetcher(url, {
      headers: { ...options.headers, range: `bytes=${offset}-${offset + length - 1}` },
    })
    if (!response.ok) throw new Error(`GGUF header request failed: HTTP ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  })
}

/** Reads growing chunks from `read` (network or disk) until the whole metadata section is in memory. */
export async function readGgufMetadataWith(
  read: (offset: number, length: number) => Promise<Uint8Array>,
): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = []
  const state = { length: 0, next: FIRST_CHUNK }
  while (true) {
    const chunk = await read(state.length, state.next)
    chunks.push(chunk)
    state.length += chunk.byteLength
    const complete = chunk.byteLength < state.next
    try {
      return parseGgufMetadata(concat(chunks, state.length))
    } catch (error) {
      if (!(error instanceof NeedMore) || complete || state.length >= MAX_BYTES) throw error
      state.next = Math.min(state.next * 2, MAX_BYTES - state.length)
    }
  }
}

/** Parses the metadata section of a GGUF buffer; throws NeedMore if the buffer ends before it does. */
export function parseGgufMetadata(bytes: Uint8Array): Record<string, unknown> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const cursor = { at: 0 }
  const need = (count: number) => {
    if (cursor.at + count > bytes.byteLength) throw new NeedMore()
  }
  const u32 = () => (need(4), (cursor.at += 4), view.getUint32(cursor.at - 4, true))
  const u64 = () => (need(8), (cursor.at += 8), Number(view.getBigUint64(cursor.at - 8, true)))
  const string = () => {
    const length = u64()
    need(length)
    cursor.at += length
    return new TextDecoder().decode(bytes.subarray(cursor.at - length, cursor.at))
  }
  const scalar = (type: Type): unknown => {
    const size = SIZE[type]
    if (type === Type.STRING) return string()
    if (size === undefined) throw new Error(`unsupported GGUF value type ${type}`)
    need(size)
    const offset = cursor.at
    cursor.at += size
    if (type === Type.U8) return view.getUint8(offset)
    if (type === Type.I8) return view.getInt8(offset)
    if (type === Type.BOOL) return view.getUint8(offset) !== 0
    if (type === Type.U16) return view.getUint16(offset, true)
    if (type === Type.I16) return view.getInt16(offset, true)
    if (type === Type.U32) return view.getUint32(offset, true)
    if (type === Type.I32) return view.getInt32(offset, true)
    if (type === Type.F32) return view.getFloat32(offset, true)
    if (type === Type.U64) return Number(view.getBigUint64(offset, true))
    if (type === Type.I64) return Number(view.getBigInt64(offset, true))
    return view.getFloat64(offset, true)
  }
  const value = (type: Type): unknown => {
    if (type !== Type.ARRAY) return scalar(type)
    const itemType = u32() as Type
    const count = u64()
    const size = SIZE[itemType]
    // Fixed-size arrays that we don't need (e.g. token scores) are skipped in one step.
    if (count > MAX_KEPT_ARRAY && size !== undefined) {
      need(count * size)
      cursor.at += count * size
      return { skipped: count }
    }
    const items = Array.from({ length: count }, () => value(itemType))
    return count > MAX_KEPT_ARRAY ? { skipped: count } : items
  }

  if (u32() !== 0x46554747) throw new Error("not a GGUF file")
  const version = u32()
  if (version < 2) throw new Error(`unsupported GGUF version ${version}`)
  u64() // tensor count
  const count = u64()
  return Object.fromEntries(
    Array.from({ length: count }, () => {
      const key = string()
      return [key, value(u32() as Type)]
    }),
  )
}

/** KV-cache layout from GGUF metadata: which layers keep a full-length cache, which only a sliding window. */
export function ggufShape(metadata: Record<string, unknown>, params: { total: number; active?: number }): ModelShape {
  const arch = String(metadata["general.architecture"])
  const read = (key: string) => metadata[`${arch}.${key}`]
  const layers = Number(read("block_count"))
  const headCount = Number(read("attention.head_count"))
  const keyLength = Number(read("attention.key_length") ?? Number(read("embedding_length")) / headCount)
  const valueLength = Number(read("attention.value_length") ?? keyLength)
  const kv = read("attention.head_count_kv")
  const window = Number(read("attention.sliding_window") ?? 0)
  const pattern = read("attention.sliding_window_pattern")
  const every = SWA_PATTERN[arch]
  const interval = Number(read("full_attention_interval") ?? 0)
  const ratios = read("attention.compress_ratios")
  // Trailing layers of Gemma E-models reuse earlier layers' cache, so only the first ones own one.
  const cached = Array.from({ length: layers - Number(read("attention.shared_kv_layers") ?? 0) }, (_, index) => ({
    index,
    kv: Number(Array.isArray(kv) ? kv[index] : (kv ?? headCount)),
    windowed:
      window > 0 && (Array.isArray(pattern) ? pattern[index] === true : every ? index % every < every - 1 : false),
    // Hybrid archs (Qwen3.5+) interleave linear-attention layers that keep no KV cache.
    linear: interval > 1 && (index + 1) % interval !== 0,
  })).filter((layer) => layer.kv > 0 && !layer.linear)
  const full = cached.filter((layer) => !layer.windowed)
  const swa = cached.filter((layer) => layer.windowed)
  return {
    paramsTotal: params.total,
    paramsActive: params.active,
    layers,
    headCountKv: Math.max(0, ...full.map((layer) => layer.kv)),
    keyLength,
    valueLength,
    // DeepSeek V4 compresses most layers' cache 4× or 128× (ratio 0 = uncompressed).
    fullAttentionLayers: Array.isArray(ratios)
      ? Math.ceil(full.reduce((sum, layer) => sum + 1 / (Number(ratios[layer.index]) || 1), 0))
      : full.length,
    swa: swa.length
      ? {
          layers: swa.length,
          window,
          headCountKv: Math.max(...swa.map((layer) => layer.kv)),
          keyLength: Number(read("attention.key_length_swa") ?? keyLength),
          valueLength: Number(read("attention.value_length_swa") ?? valueLength),
        }
      : undefined,
    contextMax: Number(read("context_length") ?? 4096),
  }
}

function concat(chunks: Uint8Array[], length: number) {
  if (chunks.length === 1) return chunks[0]
  const out = new Uint8Array(length)
  chunks.reduce((offset, chunk) => (out.set(chunk, offset), offset + chunk.byteLength), 0)
  return out
}
