import { describe, expect, test } from "bun:test"
import { hubSource, searchHub } from "./huggingface"

describe("searchHub", () => {
  test("uncensored search merges one query per marker, dedupes and sorts by the chosen order", async () => {
    const searches: string[] = []
    const results = await searchHub("qwen3", {
      sort: "downloads",
      uncensored: true,
      fetch: async (url) => {
        const search = new URL(url).searchParams.get("search") ?? ""
        searches.push(search)
        const pages: Record<string, object[]> = {
          "qwen3 abliterated": [
            { id: "a/Qwen3-4B-abliterated-GGUF", downloads: 10, gguf: { total: 4e9, architecture: "qwen3" } },
            { id: "b/Qwen3-8B-abliterated-GGUF", downloads: 50 },
          ],
          "qwen3 uncensored": [{ id: "a/Qwen3-4B-abliterated-GGUF", downloads: 10 }],
          "qwen3 heretic": [
            { id: "c/Qwen3-14B-Heretic-GGUF", downloads: 30 },
            // Not chat models: an image model and a speculative-decoding draft.
            { id: "d/Qwen-Image-Uncensored-GGUF", downloads: 90, pipeline_tag: "text-to-image" },
            { id: "e/Qwen3-DFlash-heretic-GGUF", downloads: 80, gguf: { architecture: "dflash" } },
          ],
        }
        return Response.json(pages[search] ?? [])
      },
    })
    expect(searches).toEqual(["qwen3 abliterated", "qwen3 uncensored", "qwen3 heretic"])
    expect(results.map((item) => item.repo)).toEqual([
      "b/Qwen3-8B-abliterated-GGUF",
      "c/Qwen3-14B-Heretic-GGUF",
      "a/Qwen3-4B-abliterated-GGUF",
    ])
    expect(results[2]).toMatchObject({
      name: "Qwen3-4B-abliterated",
      publisher: "a",
      uncensored: true,
      paramsTotal: 4e9,
    })
  })
})

describe("hubSource", () => {
  test("live repos get hf: ids and an uncensored kind from their name", () => {
    expect(hubSource("mradermacher/Huihui-Qwen3-4B-abliterated-GGUF")).toMatchObject({
      id: "hf:mradermacher/Huihui-Qwen3-4B-abliterated-GGUF",
      name: "Huihui-Qwen3-4B-abliterated",
      uncensored: "abliterated",
    })
    expect(hubSource("unsloth/Qwen3-4B-GGUF").uncensored).toBeNull()
    expect(hubSource("x/Gemma-4-12B-Heretic-GGUF").uncensored).toBe("heretic")
  })
})
