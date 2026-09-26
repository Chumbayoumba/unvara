import { app } from "electron"

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

// Unvara has no release feed yet; re-enable once electron-builder `publish` points at Unvara releases.
export const UPDATER_ENABLED = false && app.isPackaged && CHANNEL !== "dev"
