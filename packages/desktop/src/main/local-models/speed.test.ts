import { describe, expect, test } from "bun:test"
import { createSpeedMeter } from "./speed"

describe("createSpeedMeter", () => {
  test("attributes reply timings to the model behind each router child port", () => {
    const samples: [string, number][] = []
    const meter = createSpeedMeter((model, speed) => samples.push([model, speed]))
    ;[
      "1.32.475.272 I srv  proxy_reques: proxying request to model llama-3b on port 64851",
      "[64851] 18.27.009.066 I slot print_timing: id  0 | task 2137 | prompt eval time =    159.74 ms /   552 tokens (    0.29 ms per token,  3455.62 tokens per second)",
      "[64851] 18.27.009.066 I slot print_timing: id  0 | task 2137 |        eval time =    421.40 ms /    58 tokens (    7.27 ms per token,   137.64 tokens per second)",
      // Too short to trust.
      "[64851] 18.27.009.066 I slot print_timing: id  0 | task 2138 |        eval time =     73.24 ms /     7 tokens (   12.21 ms per token,    81.92 tokens per second)",
      // A port the meter never saw a model for.
      "[50000] 18.27.009.066 I slot print_timing: id  0 | task 1 |        eval time =    100.00 ms /    40 tokens (    2.50 ms per token,   400.00 tokens per second)",
    ].forEach(meter)
    expect(samples).toEqual([["llama-3b", 137.64]])
  })
})
