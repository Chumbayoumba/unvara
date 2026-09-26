#!/usr/bin/env bun
/**
 * After the installer is signed (SignPath), its bytes change, so the update feed must describe the signed file:
 * recompute sha512 and size in latest.yml and drop the now-stale blockmap size (updates fall back to a full download).
 * Usage: bun scripts/rehash-latest-yml.ts <dist dir>
 */
import { createHash } from "node:crypto"
import path from "node:path"

const dir = process.argv[2] ?? "dist"
const feed = path.join(dir, "latest.yml")
const text = await Bun.file(feed).text()
const installer = text.match(/^path:\s*(.+)$/m)?.[1]?.trim()
if (!installer) throw new Error(`${feed} has no installer path`)
const bytes = await Bun.file(path.join(dir, installer)).bytes()
const sha512 = createHash("sha512").update(bytes).digest("base64")

await Bun.write(
  feed,
  text
    .replace(/sha512: .+/g, `sha512: ${sha512}`)
    .replace(/(\n\s+size:) \d+/, `$1 ${bytes.length}`)
    .replace(/\n\s+blockMapSize: \d+/, ""),
)
console.log(`latest.yml now describes ${installer} (${bytes.length} bytes)`)
