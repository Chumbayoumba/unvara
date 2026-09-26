import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { UserEnv } from "@opencode-ai/core/util/user-env"
import { tmpdir } from "../fixture/tmpdir"

const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name)

describe("connectorCommand", () => {
  test("runs npx and uvx connectors through Unvara's runtimes when the PC has neither", async () => {
    await using runtimes = await tmpdir()
    await using empty = await tmpdir()
    await fs.writeFile(path.join(runtimes.path, exe("bun")), "")
    await fs.writeFile(path.join(runtimes.path, exe("uvx")), "")
    const env = { UNVARA_RUNTIMES: runtimes.path, PATH: empty.path }

    expect(UserEnv.connectorCommand(["npx", "-y", "@modelcontextprotocol/server-memory"], env)).toEqual([
      path.join(runtimes.path, exe("bun")),
      "x",
      "--bun",
      "@modelcontextprotocol/server-memory",
    ])
    expect(UserEnv.connectorCommand(["uvx", "mcp-server-fetch"], env)).toEqual([
      path.join(runtimes.path, exe("uvx")),
      "mcp-server-fetch",
    ])
    expect(UserEnv.connectorCommand(["docker", "run", "x"], env)).toEqual(["docker", "run", "x"])
  })

  test("leaves the command alone when a real npx is on the PATH or no runtime is installed", async () => {
    await using runtimes = await tmpdir()
    await using node = await tmpdir()
    await fs.writeFile(path.join(node.path, process.platform === "win32" ? "npx.cmd" : "npx"), "", { mode: 0o755 })
    const command = ["npx", "-y", "pkg"]
    expect(UserEnv.connectorCommand(command, { UNVARA_RUNTIMES: runtimes.path, PATH: node.path })).toEqual(command)
    // No bun downloaded yet.
    expect(UserEnv.connectorCommand(command, { UNVARA_RUNTIMES: runtimes.path, PATH: runtimes.path })).toEqual(command)
  })
})
