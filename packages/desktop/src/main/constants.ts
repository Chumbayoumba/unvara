import { app } from "electron"

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

// Updates come from GitHub Releases of Chumbayoumba/unvara (electron-builder `publish`); only release builds have
// that feed.
export const UPDATER_ENABLED = app.isPackaged && CHANNEL === "prod"
