/**
 * Hugging Face GGUF repos as catalog entries. script/catalog/build.ts uses this for the curated catalog and the
 * desktop app for live search, so both describe a model the same way: sizes, sha256, quants and KV-cache dims.
 */
import { downloadUrl, type CatalogFile, type CatalogModel, type CatalogQuant } from "./catalog"
import { ggufShape, readGgufMetadata } from "./gguf"
import { defaultQuant, isAuxiliaryGguf, parseQuant } from "./quant"

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>
type Options = { fetch?: Fetcher; mirror?: string; headers?: Record<string, string> }

/** One entry of catalog/sources.yaml; live search synthesizes one per repo. */
export type CatalogSource = {
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

export type HubSort = "downloads" | "trending" | "recent"

export type HubResult = {
  repo: string
  name: string
  publisher: string
  uncensored: boolean
  arch?: string
  paramsTotal?: number
  downloads: number
  likes: number
  updatedAt: string
}

type Sibling = { rfilename: string; size?: number; lfs?: { sha256: string; size: number } }
type RawResult = {
  id: string
  downloads?: number
  likes?: number
  trendingScore?: number
  lastModified?: string
  pipeline_tag?: string
  gguf?: { total?: number; architecture?: string }
}

const HF = "https://huggingface.co"
const SEARCH_LIMIT = 30
// HF's search ANDs its terms, so "uncensored only" merges one search per common marker.
const UNCENSORED_MARKERS = ["abliterated", "uncensored", "heretic"]
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

export async function searchHub(
  query: string,
  options: Options & { sort: HubSort; uncensored: boolean },
): Promise<HubResult[]> {
  const terms = options.uncensored ? UNCENSORED_MARKERS.map((marker) => `${query} ${marker}`.trim()) : [query.trim()]
  const pages = await Promise.all(
    terms.map((search) => {
      const params = new URLSearchParams({
        filter: "gguf",
        search,
        sort: { downloads: "downloads", trending: "trendingScore", recent: "lastModified" }[options.sort],
        direction: "-1",
        limit: String(SEARCH_LIMIT),
      })
      ;["gguf", "downloads", "likes", "lastModified", "trendingScore", "pipeline_tag"].forEach((field) =>
        params.append("expand[]", field),
      )
      return api<RawResult[]>(`/api/models?${params}`, options)
    }),
  )
  const unique = pages
    .flat()
    .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
    .filter(chatModel)
  const rank = (item: RawResult) => {
    if (options.sort === "trending") return item.trendingScore ?? 0
    if (options.sort === "recent") return Date.parse(item.lastModified ?? "") || 0
    return item.downloads ?? 0
  }
  return unique
    .toSorted((a, b) => rank(b) - rank(a))
    .slice(0, SEARCH_LIMIT)
    .map((item) => ({
      repo: item.id,
      name: displayName(item.id),
      publisher: item.id.split("/")[0],
      uncensored: uncensoredKind(item.id) !== null,
      arch: item.gguf?.architecture,
      paramsTotal: item.gguf?.total,
      downloads: item.downloads ?? 0,
      likes: item.likes ?? 0,
      updatedAt: item.lastModified ?? "",
    }))
}

/** A catalog source for any GGUF repo found by live search (`hf:<repo>` ids never clash with curated ones). */
export function hubSource(repo: string): CatalogSource {
  return {
    id: `hf:${repo}`,
    repo,
    name: displayName(repo),
    family: "",
    uncensored: uncensoredKind(repo),
    description: { en: "", ru: "" },
  }
}

/** Reads the repo's files and the recommended quant's GGUF header into a catalog entry. */
export async function buildCatalogModel(source: CatalogSource, options: Options = {}): Promise<CatalogModel> {
  const [files, info] = await Promise.all([
    api<{ siblings: Sibling[] }>(`/api/models/${source.repo}?blobs=true&files_metadata=true`, options),
    api<{
      gguf?: { total?: number; architecture?: string; context_length?: number; chat_template?: string }
      downloads?: number
      lastModified?: string
      cardData?: { license?: string }
    }>(`/api/models/${source.repo}?expand[]=gguf&expand[]=downloads&expand[]=lastModified&expand[]=cardData`, options),
  ])
  const excluded = (name: string) =>
    (source.exclude ?? []).some((part) => name.toLowerCase().includes(part.toLowerCase()))
  const ggufFiles = files.siblings.filter(
    (file) => file.rfilename.endsWith(".gguf") && !isAuxiliaryGguf(file.rfilename) && !excluded(file.rfilename),
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
  const metadata = await readGgufMetadata(downloadUrl(source.repo, recommended.files[0].name, options.mirror), {
    fetch: options.fetch,
    headers: options.headers,
  })
  const arch = String(metadata["general.architecture"] ?? info.gguf?.architecture ?? "unknown")
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
  const groups = Map.groupBy(
    files.flatMap((item) => {
      const quant = parseQuant(item.rfilename.split("/").at(-1) ?? item.rfilename)
      if (!quant || (allow && !allow.includes(quant))) return []
      return [{ quant, key: `${quant}|${item.rfilename.replace(/-\d{5}-of-\d{5}\.gguf$/i, "")}`, item }]
    }),
    (entry) => entry.key,
  )
  // Several files can carry the same quant (e.g. imatrix variants): keep the smallest set per quant.
  const candidates = [...groups.values()].map((group) => {
    const shards = group
      .map((entry) => entry.item)
      .toSorted((a, b) => a.rfilename.localeCompare(b.rfilename))
      .map(file)
    return { quant: group[0].quant, files: shards, size: shards.reduce((sum, shard) => sum + shard.size, 0) }
  })
  const smallest = [...Map.groupBy(candidates, (candidate) => candidate.quant).values()].map(
    (same) => same.toSorted((a, b) => a.size - b.size)[0],
  )
  return smallest.toSorted((a, b) => a.size - b.size)
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

/** "mradermacher/Huihui-Qwen3-4B-abliterated-GGUF" → "Huihui-Qwen3-4B-abliterated". */
function displayName(repo: string) {
  return (repo.split("/").at(-1) ?? repo).replace(/[-_.]?gguf$/i, "")
}

function uncensoredKind(repo: string): CatalogModel["uncensored"] {
  if (/heretic/i.test(repo)) return "heretic"
  if (/abliterat/i.test(repo)) return "abliterated"
  if (/uncensored/i.test(repo)) return "finetune"
  return null
}

/** Image, audio and draft-model GGUFs share the format, but llama-server can't chat with them. */
function chatModel(item: RawResult) {
  const pipeline = item.pipeline_tag
  if (pipeline && pipeline !== "text-generation" && pipeline !== "image-text-to-text") return false
  return !/^(dflash|clip)$|image|diffusion|flux/i.test(item.gguf?.architecture ?? "")
}

async function api<T>(path: string, options: Options): Promise<T> {
  const response = await (options.fetch ?? fetch)(`${options.mirror ?? HF}${path}`, { headers: options.headers })
  if (!response.ok) throw new Error(`Hugging Face ${response.status} for ${path}`)
  return response.json() as Promise<T>
}
