#!/usr/bin/env bun
/**
 * Bundles the pinned llama.cpp engine (backends marked `bundled`) into resources/engine/<backend>.
 * `bun ./scripts/fetch-engine.ts --pin b12345` re-pins engine.manifest.json to another upstream build.
 */
import { $ } from "bun"
import { mkdir, rm } from "node:fs/promises"
import { basename, join } from "node:path"

type Archive = { url: string; size: number; sha256: string }
type Backend = { archives: Archive[]; bundled: boolean; minDriver?: string; minComputeCap?: number }
type Manifest = { $comment: string; build: string; source: string; backends: Record<string, Backend> }

const MANIFEST_PATH = "engine.manifest.json"
const CACHE_DIR = "node_modules/.cache/unvara-engine"
const ENGINE_DIR = "resources/engine"

const pin = process.argv.indexOf("--pin")
if (pin !== -1) {
  await repin(process.argv[pin + 1])
  process.exit(0)
}

const manifest: Manifest = await Bun.file(MANIFEST_PATH).json()
await mkdir(CACHE_DIR, { recursive: true })
for (const [name, backend] of Object.entries(manifest.backends).filter(([, backend]) => backend.bundled)) {
  const target = join(ENGINE_DIR, name)
  const marker = Bun.file(join(target, ".build"))
  if ((await marker.exists()) && (await marker.text()) === manifest.build) {
    console.log(`engine ${name} ${manifest.build} already bundled`)
    continue
  }
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  for (const archive of backend.archives) {
    const file = await download(archive)
    await $`tar -xf ${file} -C ${target}`
  }
  await Bun.write(marker, manifest.build)
  console.log(`engine ${name} ${manifest.build} bundled into ${target}`)
}

async function download(archive: Archive) {
  const file = join(CACHE_DIR, basename(new URL(archive.url).pathname))
  if ((await Bun.file(file).exists()) && (await sha256(file)) === archive.sha256) return file
  console.log(`downloading ${archive.url}`)
  const response = await fetch(archive.url)
  if (!response.ok) throw new Error(`download failed ${response.status} ${archive.url}`)
  await Bun.write(file, response)
  const actual = await sha256(file)
  if (actual !== archive.sha256) throw new Error(`sha256 mismatch for ${file}: ${actual} != ${archive.sha256}`)
  return file
}

async function sha256(file: string) {
  return new Bun.CryptoHasher("sha256").update(await Bun.file(file).arrayBuffer()).digest("hex")
}

async function repin(build: string | undefined) {
  if (!build) throw new Error("usage: fetch-engine.ts --pin <build>")
  const release = await fetch(`https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/${build}`).then(
    (response) => response.json() as Promise<{ assets: { name: string; size: number; digest: string; browser_download_url: string }[] }>,
  )
  const asset = (name: string): Archive => {
    const found = release.assets.find((item) => item.name === name)
    if (!found) throw new Error(`asset ${name} missing from ${build}`)
    return { url: found.browser_download_url, size: found.size, sha256: found.digest.replace("sha256:", "") }
  }
  const current: Manifest = await Bun.file(MANIFEST_PATH).json()
  const next: Manifest = {
    ...current,
    build,
    source: `https://github.com/ggml-org/llama.cpp/releases/tag/${build}`,
    backends: Object.fromEntries(
      Object.entries(current.backends).map(([name, backend]) => [
        name,
        {
          ...backend,
          archives: backend.archives.map((archive) =>
            asset(basename(new URL(archive.url).pathname).replace(/b\d+/, build)),
          ),
        },
      ]),
    ),
  }
  await Bun.write(MANIFEST_PATH, JSON.stringify(next, null, 2) + "\n")
  console.log(`pinned engine to ${build}`)
}
