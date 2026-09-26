import { readFileSync } from "node:fs"
import type { Hooks, PluginInput } from "@opencode-ai/plugin"

type ManifestModel = {
  id: string
  name: string
  context: number
  output: number
  toolCall: boolean
  reasoning: boolean
  vision: boolean
}

// Cold-loading a multi-GB model or CPU prompt processing of a large agent prompt can exceed the 300 s default.
const LOCAL_TIMEOUT = 30 * 60 * 1000

/**
 * Exposes models installed through the Unvara desktop app (served by its llama.cpp router) as the `unvara`
 * provider. The desktop sets UNVARA_LLAMA_URL / UNVARA_LLAMA_KEY / UNVARA_MODELS_MANIFEST before spawning this
 * server; outside the desktop app the plugin does nothing.
 */
export async function UnvaraLocalPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    config: async (config) => {
      const manifest = process.env.UNVARA_MODELS_MANIFEST
      if (!process.env.UNVARA_LLAMA_URL || !manifest) return
      config.provider = {
        ...config.provider,
        unvara: {
          name: "Local",
          npm: "@ai-sdk/openai-compatible",
          env: ["UNVARA_LLAMA_KEY"],
          options: {
            baseURL: "${UNVARA_LLAMA_URL}",
            timeout: false,
            headerTimeout: LOCAL_TIMEOUT,
            chunkTimeout: LOCAL_TIMEOUT,
          },
          models: Object.fromEntries(
            readModels(manifest).map((model) => [
              model.id,
              {
                name: model.name,
                // Empty release date keeps local models visible in the picker by default.
                release_date: "",
                tool_call: model.toolCall,
                reasoning: model.reasoning,
                // Reasoning is kept by llama.cpp's chat template; never echo it back and burn a small context.
                interleaved: false,
                attachment: model.vision,
                modalities: { input: model.vision ? ["text", "image"] : ["text"], output: ["text"] },
                limit: { context: model.context, output: model.output },
                cost: { input: 0, output: 0 },
              },
            ]),
          ),
        },
      }
    },
  }
}

function readModels(file: string): ManifestModel[] {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { models?: ManifestModel[] }
    return Array.isArray(parsed.models) ? parsed.models : []
  } catch {
    return []
  }
}
