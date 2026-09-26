// Short replies are dominated by warm-up and give noisy numbers.
const MIN_TOKENS = 16

/**
 * Follows llama-server router logs, so nothing extra has to run: the router says when it starts loading a model
 * and which child port serves it; the child says when the model is loaded and prints the timing of every reply.
 */
export function createRouterLogObserver(handlers: {
  loading: (model: string) => void
  loaded: (model: string) => void
  speed: (model: string, tokensPerSecond: number) => void
}) {
  const ports = new Map<string, string>()
  return (line: string) => {
    const waiting = line.match(/waiting until model name=(\S+) is fully loaded/)
    if (waiting) return handlers.loading(waiting[1])
    const spawned = line.match(/spawning server instance with name=(\S+) on port (\d+)/)
    const proxied = line.match(/proxying request to model (\S+) on port (\d+)/)
    const route = spawned ?? proxied
    if (route) {
      ports.set(route[2], route[1])
      return
    }
    const loaded = line.match(/^\[(\d+)\].*llama_server: model loaded/)
    if (loaded) {
      const model = ports.get(loaded[1])
      if (model) handlers.loaded(model)
      return
    }
    // "[64851] … | task 2137 |        eval time =  73.24 ms /  7 tokens (  12.21 ms per token,  81.92 tokens per second)"
    // ("prompt eval time" lines are prompt processing, not generation).
    const timing = line.match(
      /^\[(\d+)\].*\|\s+eval time =\s*[\d.]+ ms \/\s*(\d+) tokens \(\s*[\d.]+ ms per token,\s*([\d.]+) tokens per second\)/,
    )
    if (!timing || Number(timing[2]) < MIN_TOKENS) return
    const model = ports.get(timing[1])
    if (model) handlers.speed(model, Number(timing[3]))
  }
}
