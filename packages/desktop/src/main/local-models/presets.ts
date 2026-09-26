import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { EngineDevice, LocalModel, LocalModelsManifest } from "@opencode-ai/app/local-models/types"

/** Reads `models.json`; a missing or unreadable file means no models are installed yet. */
export function readManifest(file: string): LocalModelsManifest {
  const text = readText(file)
  if (!text) return { version: 1, models: [] }
  const parsed = JSON.parse(text) as Partial<LocalModelsManifest>
  return { version: 1, models: Array.isArray(parsed.models) ? parsed.models : [] }
}

export function writeManifest(file: string, manifest: LocalModelsManifest) {
  writeAtomic(file, JSON.stringify(manifest, null, 2) + "\n")
}

/**
 * Router preset (INI). Only non-default values are written: `fit = on` lets llama.cpp place layers itself,
 * `device`/`split-mode` pin the primary GPU, `parallel = 1` keeps the whole fitted context in one slot.
 */
export function renderPresets(models: LocalModel[], device: EngineDevice | undefined) {
  const global = {
    fit: "on",
    jinja: true,
    "flash-attn": "auto",
    parallel: 1,
    ...(device ? { device: device.id, "split-mode": "none" } : {}),
  }
  const sections = models.map((model) =>
    section(model.id, {
      model: model.path,
      ...(model.mmproj ? { mmproj: model.mmproj } : {}),
      c: model.context,
      ...(model.sampling?.temperature !== undefined ? { temp: model.sampling.temperature } : {}),
      ...(model.sampling?.topK !== undefined ? { "top-k": model.sampling.topK } : {}),
      ...(model.sampling?.topP !== undefined ? { "top-p": model.sampling.topP } : {}),
      ...(model.sampling?.minP !== undefined ? { "min-p": model.sampling.minP } : {}),
      ...model.overrides,
    }),
  )
  return ["version = 1", "", section("*", global), ...sections].join("\n")
}

export function writePresets(file: string, models: LocalModel[], device: EngineDevice | undefined) {
  writeAtomic(file, renderPresets(models, device))
}

function section(name: string, values: Record<string, string | number | boolean>) {
  const lines = Object.entries(values).map(([key, value]) => `${key} = ${value}`)
  return [`[${name}]`, ...lines, ""].join("\n")
}

export function writeAtomic(file: string, text: string) {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, text, "utf8")
  renameSync(temp, file)
}

export function readText(file: string) {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return undefined
  }
}
