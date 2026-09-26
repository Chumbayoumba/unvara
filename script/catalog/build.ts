#!/usr/bin/env bun
/**
 * Builds catalog/catalog.json from catalog/sources.yaml: file sizes and sha256 from the Hugging Face API,
 * architecture dims (for KV-cache sizing) from the remote GGUF header of the recommended quant.
 * Usage: bun script/catalog/build.ts [--only <id>]
 */
import {
  CATALOG_SCHEMA_VERSION,
  downloadUrl,
  type Catalog,
  type CatalogFile,
  type CatalogModel,
  type CatalogQuant,
} from "../../packages/app/src/local-models/catalog"
import { ggufShape, readGgufMetadata } from "../../packages/app/src/local-models/gguf"
import { defaultQuant, parseQuant } from "../../packages/app/src/local-models/quant"

type Source = {
  id: string
  repo: string
  name: string
  family: string
  uncensored: CatalogModel["uncensored"]
  base?: string
  activeParams?: number
  tags?: string[]
  capabilities?: ("tools" | "vision" | "reasoning")[]
  quants?: string[]
  exclude?: string[]
  sampling?: CatalogModel["sampling"]
  description: { en: string; ru: string }
}

type Sibling = { rfilename: string; size?: number; lfs?: { sha256: string; size: number } }

const HF = "https://huggingface.co"
const MIN_APP_VERSION = "0.1.0"
// Speculative-decoding drafts, MTP heads and imatrix data ship next to the weights but are not models to run.
const AUXILIARY = /(^|[-_./])(mtp|eagle\d*|dspark|draft|imatrix)([-_./]|$)/i
// Quant ladder offered when a source has no explicit list; repos that use none of these names get everything.
const DEFAULT_QUANTS = [
  "IQ2_M",
  "Q2_K",
  "Q2_K_XL",
  "IQ3_XXS",
  "IQ3_XS",
  "IQ3_M",
  "Q3_K_M",
  "Q3_K_XL",
  "IQ4_XS",
  "Q4_K_M",
  "Q4_K_XL",
  "Q5_K_M",
  "Q6_K",
  "Q8_0",
  "MXFP4",
]
const only = process.argv.indexOf("--only") !== -1 ? process.argv[process.argv.indexOf("--only") + 1] : undefined

const sources = Bun.YAML.parse(await Bun.file("catalog/sources.yaml").text()) as Source[]
const previous: Catalog | undefined = await Bun.file("catalog/catalog.json")
  .json()
  .catch(() => undefined)

const models = []
for (const source of sources) {
  if (only && source.id !== only) {
    const kept = previous?.models.find((model) => model.id === source.id)
    if (kept) models.push(kept)
    continue
  }
  // HF is flaky from some networks; retry a whole model a few times before giving up.
  const model = await build(source)
    .catch(() => Bun.sleep(3000).then(() => build(source)))
    .catch(() => Bun.sleep(10000).then(() => build(source)))
  console.log(
    `${model.id.padEnd(40)} ${model.arch.padEnd(10)} ${(model.paramsTotal / 1e9).toFixed(1)}B` +
      `${model.paramsActive ? `/${(model.paramsActive / 1e9).toFixed(1)}B` : ""} layers=${model.shape.layers}` +
      ` kv=${model.shape.headCountKv}x${model.shape.keyLength}` +
      `${model.shape.fullAttentionLayers ? ` full=${model.shape.fullAttentionLayers}` : ""}` +
      `${model.shape.swa ? ` swa=${model.shape.swa.layers}x${model.shape.swa.headCountKv}x${model.shape.swa.keyLength}@${model.shape.swa.window}` : ""}` +
      ` tools=${model.capabilities.tools} quants=${model.quants.map((quant) => quant.quant).join(",")}`,
  )
  models.push(model)
}

const catalog: Catalog = {
  schemaVersion: CATALOG_SCHEMA_VERSION,
  minAppVersion: MIN_APP_VERSION,
  generatedAt: new Date().toISOString(),
  models,
}
await Bun.write("catalog/catalog.json", JSON.stringify(catalog, null, 2) + "\n")
console.log(`wrote catalog/catalog.json (${models.length} models)`)

async function build(source: Source): Promise<CatalogModel> {
  const [files, info] = await Promise.all([
    hf<{ siblings: Sibling[] }>(`/api/models/${source.repo}?blobs=true&files_metadata=true`),
    hf<{
      gguf?: { total?: number; architecture?: string; context_length?: number; chat_template?: string }
      downloads?: number
      lastModified?: string
      cardData?: { license?: string }
    }>(`/api/models/${source.repo}?expand[]=gguf&expand[]=downloads&expand[]=lastModified&expand[]=cardData`),
  ])
  const excluded = (name: string) =>
    (source.exclude ?? []).some((part) => name.toLowerCase().includes(part.toLowerCase()))
  const ggufFiles = files.siblings.filter(
    (file) => file.rfilename.endsWith(".gguf") && !AUXILIARY.test(file.rfilename) && !excluded(file.rfilename),
  )
  const mmproj = ggufFiles
    .filter((file) => /mmproj/i.test(file.rfilename))
    .toSorted((a, b) => mmprojRank(a.rfilename) - mmprojRank(b.rfilename))[0]
  const weights = ggufFiles.filter((file) => !/mmproj/i.test(file.rfilename))
  const offered = groupQuants(weights, source.quants ?? DEFAULT_QUANTS)
  const quants = offered.length || source.quants ? offered : groupQuants(weights, undefined)
  if (!quants.length) throw new Error(`${source.id}: no GGUF quants found in ${source.repo}`)
  const recommendedQuant = defaultQuant(quants.map((quant) => quant.quant)) ?? quants[0].quant

  // Dims come from the file people will actually download, not from whatever else the repo holds.
  const recommended = quants.find((quant) => quant.quant === recommendedQuant) ?? quants[0]
  const metadata = await readGgufMetadata(downloadUrl(source.repo, recommended.files[0].name))
  const arch = String(metadata["general.architecture"] ?? info.gguf?.architecture ?? "unknown")
  if (info.gguf?.architecture && info.gguf.architecture !== arch)
    console.warn(`${source.id}: HF reports ${info.gguf.architecture}, ${recommended.files[0].name} is ${arch}`)
  const expertCount = Number(metadata[`${arch}.expert_count`] ?? 0)
  const expertUsed = Number(metadata[`${arch}.expert_used_count`] ?? 0)
  const paramsTotal = Number(info.gguf?.total ?? 0)
  const paramsActive = source.activeParams
    ? source.activeParams * 1e9
    : expertCount > 0 && expertUsed > 0
      ? paramsTotal * (0.1 + (0.9 * expertUsed) / expertCount)
      : undefined
  const template = info.gguf?.chat_template ?? String(metadata["tokenizer.chat_template"] ?? "")
  const forced = new Set(source.capabilities ?? [])
  const shape = ggufShape(metadata, { total: paramsTotal, active: paramsActive })

  return {
    id: source.id,
    name: source.name,
    family: source.family,
    repo: source.repo,
    publisher: source.repo.split("/")[0],
    uncensored: source.uncensored ?? null,
    base: source.base,
    description: source.description,
    tags: source.tags ?? [],
    capabilities: {
      tools: forced.has("tools") || /\btools\b/.test(template),
      vision: forced.has("vision") || Boolean(mmproj),
      reasoning: forced.has("reasoning") || /<think>|reasoning|analysis<\|message\|>/.test(template),
    },
    license: info.cardData?.license,
    arch,
    paramsTotal,
    paramsActive,
    contextMax: shape.contextMax,
    shape,
    quants,
    recommendedQuant,
    mmproj: mmproj ? file(mmproj) : undefined,
    sampling: source.sampling,
    downloads: info.downloads ?? 0,
    updatedAt: info.lastModified ?? "",
  }
}

/** Groups files by quant; split GGUFs (`-00001-of-00003`) become one quant with ordered shards. */
function groupQuants(files: Sibling[], allow: string[] | undefined): CatalogQuant[] {
  const groups = new Map<string, Sibling[]>()
  for (const item of files) {
    const quant = parseQuant(item.rfilename.split("/").at(-1) ?? item.rfilename)
    if (!quant || (allow && !allow.includes(quant))) continue
    const key = `${quant}|${item.rfilename.replace(/-\d{5}-of-\d{5}\.gguf$/i, "")}`
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  // Several files can carry the same quant (e.g. imatrix variants): keep the smallest set per quant.
  const byQuant = new Map<string, CatalogQuant>()
  for (const [key, group] of groups) {
    const quant = key.split("|")[0]
    const shards = group.toSorted((a, b) => a.rfilename.localeCompare(b.rfilename)).map(file)
    const candidate = { quant, files: shards, size: shards.reduce((sum, shard) => sum + shard.size, 0) }
    const current = byQuant.get(quant)
    if (!current || candidate.size < current.size) byQuant.set(quant, candidate)
  }
  return [...byQuant.values()].toSorted((a, b) => a.size - b.size)
}

function file(item: Sibling): CatalogFile {
  return { name: item.rfilename, size: item.lfs?.size ?? item.size ?? 0, sha256: item.lfs?.sha256 ?? "" }
}

/** Prefer an f16 / q8 projector: small quality loss matters more for vision than size. */
function mmprojRank(name: string) {
  if (/f16/i.test(name)) return 0
  if (/q8/i.test(name)) return 1
  return 2
}

async function hf<T>(path: string): Promise<T> {
  const response = await fetch(`${HF}${path}`)
  if (!response.ok) throw new Error(`HF ${response.status} for ${path}`)
  return response.json() as Promise<T>
}
