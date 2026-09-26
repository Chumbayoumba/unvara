import { describe, expect, test } from "bun:test"
import { LLMRequestPrep } from "@/session/llm/request"

type Input = Parameters<typeof LLMRequestPrep.resolveTools>[0]

const TOOLS = [
  "read",
  "edit",
  "write",
  "glob",
  "grep",
  "bash",
  "webfetch",
  "todowrite",
  "task",
  "skill",
  "github_list_issues",
]

function resolve(options: { provider: string; context: number; agent?: string; toolcall?: boolean }) {
  return Object.keys(
    LLMRequestPrep.resolveTools({
      tools: Object.fromEntries(TOOLS.map((name) => [name, {}])),
      agent: { name: options.agent ?? "build", permission: [] },
      user: {},
      model: {
        providerID: options.provider,
        capabilities: { toolcall: options.toolcall ?? true },
        limit: { context: options.context, output: 4096 },
      },
    } as unknown as Input),
  )
}

describe("Unvara tool resolution", () => {
  test("local models with a short window get only the core tools", () => {
    expect(resolve({ provider: "unvara", context: 16384 })).toEqual([
      "read",
      "edit",
      "write",
      "glob",
      "grep",
      "bash",
      "webfetch",
      "todowrite",
    ])
  })

  test("local models with 32k or more, and cloud models, keep every tool", () => {
    expect(resolve({ provider: "unvara", context: 32768 })).toEqual(TOOLS)
    expect(resolve({ provider: "anthropic", context: 8192 })).toEqual(TOOLS)
  })

  test("chat mode and models without tool calling get none", () => {
    expect(resolve({ provider: "unvara", context: 65536, agent: "chat" })).toEqual([])
    expect(resolve({ provider: "unvara", context: 65536, toolcall: false })).toEqual([])
  })
})
