#!/usr/bin/env bun
/**
 * Signs catalog/catalog.json with the release key (ed25519) into catalog/catalog.json.sig, which the app checks before
 * trusting a catalog fetched from the internet. The private key never lives in the repo.
 * Usage: UNVARA_CATALOG_KEY=path/to/catalog-signing-key.pem bun script/catalog/sign.ts
 */
import { createPrivateKey, sign } from "node:crypto"

const keyFile = process.env.UNVARA_CATALOG_KEY
if (!keyFile) throw new Error("Set UNVARA_CATALOG_KEY to the catalog signing key (PEM)")
const key = createPrivateKey(await Bun.file(keyFile).text())
const catalog = await Bun.file("catalog/catalog.json").bytes()
await Bun.write("catalog/catalog.json.sig", sign(null, catalog, key).toString("base64") + "\n")
console.log("signed catalog/catalog.json")
