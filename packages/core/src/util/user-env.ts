import { existsSync } from "node:fs"
import path from "node:path"
import { which } from "./which"

const XDG_KEYS = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"]
// Internal to the Unvara desktop <-> server handshake; never handed to user processes.
const INTERNAL_KEYS = ["UNVARA_LLAMA_KEY", "UNVARA_LLAMA_URL", "UNVARA_MODELS_MANIFEST", "UNVARA_RUNTIMES"]

/**
 * Environment for processes the agent starts on the user's behalf (shell commands, MCP servers).
 * The Unvara desktop points the XDG dirs at its own folders to stay isolated from an installed OpenCode and passes
 * the user's originals as `UNVARA_USER_<KEY>`; restoring them keeps git, gh, uv and friends on the user's config.
 */
export function userProcessEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const restored = Object.fromEntries(
    XDG_KEYS.flatMap((key) => {
      const original = base[`UNVARA_USER_${key}`]
      return original === undefined ? [] : [[key, original]]
    }),
  )
  return Object.fromEntries(
    Object.entries({ ...base, ...restored }).filter(
      ([key, value]) =>
        !key.startsWith("UNVARA_USER_") && !INTERNAL_KEYS.includes(key) && !(key in restored && value === ""),
    ),
  )
}

/**
 * MCP connectors usually start with `npx` or `uvx`, which most people don't have. When the PC lacks them, the
 * Unvara desktop installs pinned bun and uv into `UNVARA_RUNTIMES`, and connectors run through those instead.
 * A real Node or uv on the PATH always wins.
 */
export function connectorCommand(command: string[], base: NodeJS.ProcessEnv = process.env): string[] {
  const runtimes = base.UNVARA_RUNTIMES
  const [cmd, ...args] = command
  if (!runtimes || !cmd || which(cmd, base)) return command
  const bun = path.join(runtimes, process.platform === "win32" ? "bun.exe" : "bun")
  const uvx = path.join(runtimes, process.platform === "win32" ? "uvx.exe" : "uvx")
  // bun x has no -y (it never prompts); --bun runs Node CLIs on bun itself, since Node may not be installed.
  if (cmd === "npx" && existsSync(bun))
    return [bun, "x", "--bun", ...args.filter((arg) => arg !== "-y" && arg !== "--yes")]
  if (cmd === "uvx" && existsSync(uvx)) return [uvx, ...args]
  return command
}

export * as UserEnv from "./user-env"
