#!/usr/bin/env bun
/**
 * Builds catalog/catalog.json from catalog/sources.yaml: file sizes and sha256 from the Hugging Face API,
 * architecture dims (for KV-cache sizing) from the remote GGUF header of the recommended quant.
 * Usage: bun script/catalog/build.ts [--only <id>]
 */
import { CATALOG_SCHEMA_VERSION, type Catalog } from "../../packages/app/src/local-models/catalog"
import { buildCatalogModel, type CatalogSource } from "../../packages/app/src/local-models/huggingface"

const MIN_APP_VERSION = "0.1.0"
const only = process.argv.indexOf("--only") !== -1 ? process.argv[process.argv.indexOf("--only") + 1] : undefined

const sources = Bun.YAML.parse(await Bun.file("catalog/sources.yaml").text()) as CatalogSource[]
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
  const model = await buildCatalogModel(source)
    .catch(() => Bun.sleep(3000).then(() => buildCatalogModel(source)))
    .catch(() => Bun.sleep(10000).then(() => buildCatalogModel(source)))
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
