/**
 * GGUF quantization helpers. Filename parsing follows Jan (Apache-2.0); quality penalties follow llmfit
 * (MIT, © 2026 Alex Jones). See THIRD_PARTY_NOTICES.md.
 */

// e.g. "Qwen3-4B-Instruct-2507-Q4_K_M.gguf", "model-IQ3_XXS.gguf", "model.BF16-00001-of-00002.gguf"
const QUANT_PATTERN = /(?:^|[-_.])(IQ\d+(?:_[A-Z0-9]+)+|Q\d+(?:_[A-Z0-9]+)*|BF16|F16|F32|MXFP4)(?=[-_.]|$)/i

export function parseQuant(filename: string) {
  const name = filename.replace(/\.gguf$/i, "").replace(/-\d{5}-of-\d{5}$/i, "")
  // The quant is the last tag in the name: "…-gpt-oss-20b-BF16-abliterated-Q4_K_M" is Q4_K_M, not BF16.
  return [...name.matchAll(new RegExp(QUANT_PATTERN, "gi"))].at(-1)?.[1]?.toUpperCase()
}

/** Approximate bits per weight, used only when the exact file size is unknown. */
const BITS: Record<string, number> = {
  F32: 32,
  F16: 16,
  BF16: 16,
  Q8_0: 8.5,
  Q6_K: 6.56,
  Q5_K_M: 5.69,
  Q5_K_S: 5.54,
  Q5_0: 5.5,
  Q5_1: 6,
  Q4_K_M: 4.85,
  Q4_K_S: 4.58,
  Q4_K_L: 5.2,
  Q4_0: 4.55,
  Q4_1: 5,
  IQ4_NL: 4.5,
  IQ4_XS: 4.25,
  MXFP4: 4.25,
  Q3_K_L: 4.27,
  Q3_K_M: 3.91,
  Q3_K_S: 3.5,
  IQ3_M: 3.66,
  IQ3_S: 3.44,
  IQ3_XS: 3.3,
  IQ3_XXS: 3.06,
  Q2_K_L: 3.4,
  Q2_K: 3.0,
  IQ2_M: 2.7,
  IQ2_S: 2.5,
  IQ2_XS: 2.31,
  IQ2_XXS: 2.06,
  IQ1_M: 1.75,
  IQ1_S: 1.56,
}

export function quantBits(quant: string) {
  return BITS[quant.toUpperCase()] ?? 4.85
}

/** Nominal precision bucket (2, 3, 4, 5, 6, 8, 16…) used for quality penalties and grouping. */
export function quantLevel(quant: string) {
  const upper = quant.toUpperCase()
  if (upper === "MXFP4") return 4
  const match = upper.match(/^I?Q(\d+)|^B?F(\d+)$/)
  return Number(match?.[1] ?? match?.[2] ?? 4)
}

/** llmfit quality penalty by precision (native-precision releases such as MXFP4 cost nothing). */
export function qualityPenalty(quant: string) {
  if (quant.toUpperCase() === "MXFP4") return 0
  const level = quantLevel(quant)
  if (level >= 8) return 0
  if (level === 6) return -1
  if (level === 5) return -2
  if (level === 4) return -5
  if (level === 3) return -8
  if (level === 2) return -12
  return -18
}

/** Jan's name-based grouping, shown next to quants in the Hub. */
export function quantSize(quant: string): "small" | "balanced" | "large" {
  const level = quantLevel(quant)
  if (level >= 6) return "large"
  if (level === 5 || /^(Q4_K|IQ4)/i.test(quant)) return "balanced"
  return "small"
}

/** Default download choice (Jan): IQ4_XS or Q4_K_M first, then the closest 4-bit, then anything. */
export function defaultQuant(quants: string[]) {
  const upper = quants.map((quant) => quant.toUpperCase())
  const preferred = ["Q4_K_M", "IQ4_XS", "Q4_K_S", "IQ4_NL", "Q4_0"].find((quant) => upper.includes(quant))
  return preferred ?? quants.find((quant) => quantLevel(quant) === 4) ?? quants[0]
}
