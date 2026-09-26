// Short replies are dominated by warm-up and give noisy numbers.
const MIN_TOKENS = 16

/**
 * Measures real generation speed from llama-server router logs, so nothing extra has to run: the router says which
 * child port serves which model, and each child prints the timing of every reply.
 */
export function createSpeedMeter(onSample: (model: string, tokensPerSecond: number) => void) {
  const ports = new Map<string, string>()
  return (line: string) => {
    const proxy = line.match(/proxying request to model (\S+) on port (\d+)/)
    if (proxy) {
      ports.set(proxy[2], proxy[1])
      return
    }
    // "[64851] … | task 2137 |        eval time =  73.24 ms /  7 tokens (  12.21 ms per token,  81.92 tokens per second)"
    // ("prompt eval time" lines are prompt processing, not generation).
    const timing = line.match(
      /^\[(\d+)\].*\|\s+eval time =\s*[\d.]+ ms \/\s*(\d+) tokens \(\s*[\d.]+ ms per token,\s*([\d.]+) tokens per second\)/,
    )
    if (!timing || Number(timing[2]) < MIN_TOKENS) return
    const model = ports.get(timing[1])
    if (model) onSample(model, Number(timing[3]))
  }
}
