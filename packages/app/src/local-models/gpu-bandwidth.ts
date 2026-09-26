/**
 * Memory bandwidth (GB/s) by GPU model, ported from llmfit `gpu_memory_bandwidth_gbps` (MIT, © 2026 Alex Jones).
 * Token generation is bandwidth-bound, so this drives the tok/s estimate. Order matters: more specific names first.
 */
const TABLE: [string, number][] = [
  ["5090", 1792], ["5080", 960], ["5070 ti", 896], ["5070", 672], ["5060 ti", 448], ["5060", 256],
  ["4090", 1008], ["4080 super", 736], ["4080", 717], ["4070 ti super", 672], ["4070 ti", 504], ["4070 super", 504],
  ["4070", 504], ["4060 ti", 288], ["4060", 272],
  ["3090 ti", 1008], ["3090", 936], ["3080 ti", 912], ["3080", 760], ["3070 ti", 608], ["3070", 448],
  ["3060 ti", 448], ["3060", 360],
  ["2080 ti", 616], ["2080 super", 496], ["2080", 448], ["2070 super", 448], ["2070", 448], ["2060 super", 448],
  ["2060", 336], ["1660 ti", 288], ["1660 super", 336], ["1660", 192], ["1650 super", 192], ["1650", 128],
  ["h100 sxm", 3350], ["h100", 2039], ["h200", 4800], ["a100 sxm", 2039], ["a100", 1555], ["l40s", 864], ["l40", 864],
  ["l4", 300], ["a10g", 600], ["a10", 600], ["t4", 320], ["v100 sxm", 900], ["v100", 897], ["a6000", 768],
  ["a5000", 768], ["a4000", 448],
  ["8060s", 256], ["9070 xt", 624], ["9070", 488], ["7900 xtx", 960], ["7900 xt", 800], ["7900 gre", 576],
  ["7800 xt", 624], ["7700 xt", 432], ["7600", 288], ["6950 xt", 576], ["6900 xt", 512], ["6800 xt", 512],
  ["6800", 512], ["6700 xt", 384], ["6600 xt", 256], ["6600", 224],
  ["mi300x", 5300], ["mi300", 5300], ["mi250x", 3277], ["mi250", 3277], ["mi210", 1638], ["mi100", 1229],
]

/** Laptop parts share model numbers with desktop cards but have narrower buses; don't guess for them. */
export function gpuBandwidth(name: string) {
  const lower = name.toLowerCase()
  if (lower.includes("laptop") || lower.includes("mobile") || lower.includes("max-q")) return undefined
  return TABLE.find(([key]) => lower.includes(key))?.[1]
}
