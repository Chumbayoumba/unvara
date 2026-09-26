const XDG_KEYS = ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME"]
// Internal to the Unvara desktop <-> server handshake; never handed to user processes.
const INTERNAL_KEYS = ["UNVARA_LLAMA_KEY", "UNVARA_LLAMA_URL", "UNVARA_MODELS_MANIFEST"]

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

export * as UserEnv from "./user-env"
