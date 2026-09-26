import { createPublicKey, verify } from "node:crypto"
import { CATALOG_SCHEMA_VERSION, type Catalog } from "@opencode-ai/app/local-models/catalog"
import type { Fetcher } from "./downloader"
import { readText, writeAtomic } from "./presets"

/**
 * The model catalog can be updated without an app release: the repo's catalog/catalog.json is fetched at startup
 * (jsDelivr first, since raw.githubusercontent.com is unreliable in some regions) and used only when it is signed
 * with the release key, made for this app version, and newer than what the app already has.
 */
// ed25519 public key (SPKI, DER, base64); script/catalog/sign.ts signs with the matching private key.
const PUBLIC_KEY = "MCowBQYDK2VwAyEAU9hEA5wBesrebOc1nLqdBPNfq69iUY7o29+nnpx9zA0="
const SOURCES = [
  "https://cdn.jsdelivr.net/gh/Chumbayoumba/unvara@main/catalog/",
  "https://raw.githubusercontent.com/Chumbayoumba/unvara/main/catalog/",
]

/** The catalog to use now: a verified cached download when it beats the bundled snapshot. */
export function cachedCatalog(file: string, bundled: Catalog, appVersion: string) {
  const text = readText(file)
  const signature = readText(`${file}.sig`)
  const cached = text && signature ? verifyCatalog(text, signature) : undefined
  return cached && usable(cached, bundled, appVersion) ? cached : bundled
}

/** Fetches the published catalog; resolves with it when it is verified and newer than `current`. */
export async function refreshCatalog(options: { file: string; current: Catalog; appVersion: string; fetch: Fetcher }) {
  for (const base of SOURCES) {
    const [text, signature] = await Promise.all(
      ["catalog.json", "catalog.json.sig"].map((name) =>
        options
          .fetch(`${base}${name}`)
          .then((response) => (response.ok ? response.text() : undefined))
          .catch(() => undefined),
      ),
    )
    if (!text || !signature) continue
    const catalog = verifyCatalog(text, signature)
    if (!catalog) continue
    if (!usable(catalog, options.current, options.appVersion)) return
    writeAtomic(options.file, text)
    writeAtomic(`${options.file}.sig`, signature)
    return catalog
  }
}

export function verifyCatalog(text: string, signature: string): Catalog | undefined {
  const key = createPublicKey({ key: Buffer.from(PUBLIC_KEY, "base64"), format: "der", type: "spki" })
  if (!verify(null, Buffer.from(text), key, Buffer.from(signature.trim(), "base64"))) return
  const catalog = JSON.parse(text) as Catalog
  return Array.isArray(catalog.models) ? catalog : undefined
}

function usable(candidate: Catalog, current: Catalog, appVersion: string) {
  return (
    candidate.schemaVersion === CATALOG_SCHEMA_VERSION &&
    atLeast(appVersion, candidate.minAppVersion) &&
    Date.parse(candidate.generatedAt) > Date.parse(current.generatedAt)
  )
}

/** Plain dotted-number comparison; pre-release tags are ignored. */
function atLeast(version: string, minimum: string) {
  const parts = (value: string) => value.split("-")[0].split(".").map(Number)
  const [a, b] = [parts(version), parts(minimum)]
  const difference = Array.from(
    { length: Math.max(a.length, b.length) },
    (_, index) => (a[index] ?? 0) - (b[index] ?? 0),
  )
  return (difference.find((value) => value !== 0) ?? 0) >= 0
}
