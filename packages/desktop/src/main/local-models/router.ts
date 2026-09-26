import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { RouterState } from "@opencode-ai/app/local-models/types"

type RouterOptions = {
  binaryDir: string
  presetsFile: string
  pidFile: string
  cacheDir: string
  port: number
  apiKey: string
  /** Unload the model after this long without requests; -1 keeps it loaded. */
  idleSeconds: number
  log: (message: string, extra?: Record<string, unknown>, level?: "info" | "warn" | "error") => void
  onState: (state: RouterState) => void
}

const HEALTH_TIMEOUT = 30_000
const MAX_RESTARTS = 5

/**
 * One `llama-server` in router mode: a single OpenAI-compatible endpoint that loads models from the preset file
 * on demand. The port and API key are fixed for the app lifetime so the OpenCode provider never needs rebuilding.
 */
export function createRouter(options: RouterOptions) {
  const url = `http://127.0.0.1:${options.port}`
  const state = { child: undefined as ChildProcess | undefined, stopping: false, restarts: 0 }

  async function start() {
    killStale(options.pidFile)
    state.stopping = false
    options.onState({ status: "starting" })
    const child = spawn(
      join(options.binaryDir, "llama-server.exe"),
      [
        "--models-preset",
        options.presetsFile,
        "--models-max",
        "1",
        "--host",
        "127.0.0.1",
        "--port",
        String(options.port),
        "--no-webui",
        "--sleep-idle-seconds",
        String(options.idleSeconds),
      ],
      {
        cwd: options.binaryDir,
        windowsHide: true,
        // The key goes through the environment, never argv (argv is visible in Task Manager).
        // LLAMA_CACHE isolates the router from any other llama.cpp model cache on this machine.
        env: { ...process.env, LLAMA_API_KEY: options.apiKey, LLAMA_CACHE: options.cacheDir },
      },
    )
    state.child = child
    if (child.pid) writeFileSync(options.pidFile, String(child.pid))
    child.stdout?.on("data", (chunk: Buffer) => forward(chunk, "info"))
    child.stderr?.on("data", (chunk: Buffer) => forward(chunk, "info"))
    child.on("exit", (code) => {
      state.child = undefined
      rmSync(options.pidFile, { force: true })
      if (state.stopping) return options.onState({ status: "stopped" })
      options.log("router exited", { code }, "warn")
      if (state.restarts >= MAX_RESTARTS) return options.onState({ status: "crashed", reason: `exit code ${code}` })
      state.restarts += 1
      options.onState({ status: "restarting", attempt: state.restarts })
      setTimeout(() => void start(), 1000 * 2 ** state.restarts).unref()
    })
    await waitHealthy()
    state.restarts = 0
    options.onState({ status: "idle" })
  }

  /** Synchronous so it is safe from `will-quit`: kills the router and every model instance it spawned. */
  function stopSync() {
    state.stopping = true
    const pid = state.child?.pid
    if (!pid) return
    killTree(pid)
    rmSync(options.pidFile, { force: true })
  }

  async function waitHealthy() {
    const deadline = Date.now() + HEALTH_TIMEOUT
    while (Date.now() < deadline) {
      if (await healthy()) return
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    throw new Error("llama-server router did not become healthy")
  }

  async function healthy() {
    return fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) })
      .then((response) => response.ok)
      .catch(() => false)
  }

  /** Re-reads the preset file without restarting (loaded models that changed are unloaded). */
  async function reload() {
    await request("GET", "/models?reload=1")
  }

  /** Loads a model explicitly and waits for it, so a cold multi-GB load never races OpenCode's request timeout. */
  async function load(model: string, onProgress?: (status: string) => void) {
    options.onState({ status: "loading", model })
    await request("POST", "/models/load", { model })
    while (true) {
      const status = await modelStatus(model)
      onProgress?.(status)
      if (status === "loaded") break
      if (status === "unloaded" || status === "failed") {
        options.onState({ status: "idle" })
        throw new Error(`model ${model} failed to load`)
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    options.onState({ status: "ready", model })
  }

  async function unload(model: string) {
    await request("POST", "/models/unload", { model })
    options.onState({ status: "idle" })
  }

  async function modelStatus(model: string) {
    const list = (await request("GET", "/models")) as { data: { id: string; status: { value: string } }[] }
    return list.data.find((item) => item.id === model)?.status.value ?? "unknown"
  }

  async function request(method: string, path: string, body?: unknown) {
    const response = await fetch(`${url}${path}`, {
      method,
      headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`router ${method} ${path} failed: ${response.status}`)
    return response.json() as Promise<unknown>
  }

  function forward(chunk: Buffer, level: "info" | "warn") {
    chunk
      .toString("utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .forEach((line) => options.log(line, undefined, level))
  }

  return { url, start, stopSync, reload, load, unload, modelStatus, healthy }
}

export type Router = ReturnType<typeof createRouter>

function killTree(pid: number) {
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
    } catch {
      // Already gone.
    }
    return
  }
  try {
    process.kill(pid, "SIGKILL")
  } catch {
    // Already gone.
  }
}

/** After an Electron crash the previous router keeps holding VRAM; kill it before starting a new one. */
function killStale(pidFile: string) {
  const pid = Number(readOptional(pidFile))
  if (!pid) return
  killTree(pid)
  rmSync(pidFile, { force: true })
}

function readOptional(file: string) {
  try {
    return readFileSync(file, "utf8").trim()
  } catch {
    return ""
  }
}
