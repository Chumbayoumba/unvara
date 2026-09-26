import { describe, expect, test } from "bun:test"
import { createRouterLogObserver } from "./speed"

describe("createRouterLogObserver", () => {
  test("reports loading, loaded and reply speed for the model behind each router child port", () => {
    const events: string[] = []
    const observe = createRouterLogObserver({
      loading: (model) => events.push(`loading ${model}`),
      loaded: (model) => events.push(`loaded ${model}`),
      speed: (model, speed) => events.push(`speed ${model} ${speed}`),
    })
    ;[
      "0.19.905.189 I srv  ensure_model: waiting until model name=llama-3b is fully loaded...",
      "0.19.905.394 I srv          load: spawning server instance with name=llama-3b on port 59112",
      "[59112] 0.01.205.859 I srv  llama_server: model loaded",
      "0.21.166.659 I srv  proxy_reques: proxying request to model llama-3b on port 59112",
      "[59112] 0.01.444.476 I slot print_timing: id  0 | task 0 | prompt eval time =     38.15 ms /    93 tokens (    0.41 ms per token,  2437.68 tokens per second)",
      "[59112] 0.01.444.482 I slot print_timing: id  0 | task 0 |        eval time =    161.26 ms /    24 tokens (    7.01 ms per token,   142.63 tokens per second)",
      // Too short to trust.
      "[59112] 0.01.444.482 I slot print_timing: id  0 | task 1 |        eval time =     73.24 ms /     7 tokens (   12.21 ms per token,    81.92 tokens per second)",
      // A port no model was seen on.
      "[50000] 0.01.444.482 I slot print_timing: id  0 | task 1 |        eval time =    100.00 ms /    40 tokens (    2.50 ms per token,   400.00 tokens per second)",
    ].forEach(observe)
    expect(events).toEqual(["loading llama-3b", "loaded llama-3b", "speed llama-3b 142.63"])
  })
})
