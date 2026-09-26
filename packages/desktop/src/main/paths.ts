import { basename, join } from "node:path"

/**
 * Machine-local root for heavy data (engine builds, server data, caches, runtimes). On Windows this is
 * %LOCALAPPDATA%\<appId> so multi-GB files never land in the roaming profile; elsewhere it is userData.
 */
export function localDataRoot(userDataPath: string) {
  const local = process.platform === "win32" ? process.env.LOCALAPPDATA : undefined
  return local ? join(local, basename(userDataPath)) : userDataPath
}
