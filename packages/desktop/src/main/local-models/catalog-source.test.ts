import { describe, expect, test } from "bun:test"
import { generateKeyPairSync, sign } from "node:crypto"
import { verifyCatalog } from "./catalog-source"

// A catalog signed by any other key must be rejected, whatever it contains.
describe("verifyCatalog", () => {
  const text = JSON.stringify({
    schemaVersion: 1,
    minAppVersion: "0.1.0",
    generatedAt: "2026-09-27T00:00:00Z",
    models: [],
  })

  test("rejects a catalog signed with a key other than the release key", () => {
    const other = generateKeyPairSync("ed25519").privateKey
    expect(verifyCatalog(text, sign(null, Buffer.from(text), other).toString("base64"))).toBeUndefined()
  })

  test("rejects a garbage signature", () => {
    expect(verifyCatalog(text, "bm90IGEgc2lnbmF0dXJl")).toBeUndefined()
  })

  // Regenerating catalog/catalog.json without re-running script/catalog/sign.ts fails here.
  test("accepts the committed catalog with its signature", async () => {
    const root = new URL("../../../../../catalog/", import.meta.url)
    const catalog = verifyCatalog(
      await Bun.file(new URL("catalog.json", root)).text(),
      await Bun.file(new URL("catalog.json.sig", root)).text(),
    )
    expect(catalog?.models.length).toBeGreaterThan(0)
  })
})
