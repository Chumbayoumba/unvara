import type { Config } from "@opencode-ai/sdk/v2/client"
import { createEffect } from "solid-js"
import { createStore } from "solid-js/store"
import { useServerSync } from "@/context/server-sync"

// Module-level so a change survives the settings dialog closing before it is applied.
const [queue, setQueue] = createStore<{ patch?: Config }>({})

/**
 * Saving global config makes OpenCode rebuild its instances, which interrupts running sessions. Unvara's settings
 * queue their changes here instead; top-level keys replace earlier queued values for the same key.
 */
export function queueConfig(patch: Config) {
  setQueue("patch", (current) => ({ ...current, ...patch }))
}

/** The global config as it will be once queued changes land. */
export function useEffectiveConfig() {
  const serverSync = useServerSync()
  return (): Config => ({ ...serverSync().data.config, ...queue.patch })
}

export function configQueued() {
  return queue.patch !== undefined
}

/** Mounted once in the Unvara layout: applies queued config as soon as no session is working. */
export function useQueuedConfig() {
  const serverSync = useServerSync()
  const working = () =>
    Object.values(serverSync().session.data.session_status).some((status) => status && status.type !== "idle")
  createEffect(() => {
    const patch = queue.patch
    if (!patch || working()) return
    setQueue("patch", undefined)
    void serverSync().updateConfig(patch)
  })
}
