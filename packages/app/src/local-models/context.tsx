import { createSimpleContext } from "@opencode-ai/ui/context"
import { createEffect, createMemo, on, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { usePlatform } from "@/context/platform"
import type { Catalog } from "./catalog"
import { hardwareProfile } from "./fit"
import { recommend } from "./recommend"
import type { EngineBackend, LocalModelsState } from "./types"

/** Local AI state from the desktop main process, the model catalog and what suits this PC. */
export const { use: useLocalModels, provider: LocalModelsProvider } = createSimpleContext({
  name: "LocalModels",
  init: () => {
    const platform = usePlatform()
    const api = platform.localModels
    const [store, setStore] = createStore<{ state?: LocalModelsState; catalog?: Catalog }>({})
    if (api) {
      void api.getState().then((state) => setStore("state", reconcile(state)))
      void api.getCatalog().then((catalog) => setStore("catalog", catalog))
      onCleanup(api.subscribe((state) => setStore("state", reconcile(state))))
      // A newer signed catalog can arrive while the app runs.
      createEffect(
        on(
          () => store.state?.catalogUpdatedAt,
          (updated) => updated && void api.getCatalog().then((catalog) => setStore("catalog", catalog)),
          { defer: true },
        ),
      )
    }

    const hardware = createMemo(() => {
      const state = store.state
      if (!state?.system) return
      return hardwareProfile(state.system, runningBackend(state), state.settings.modelsDir)
    })
    const recommendation = createMemo(() => {
      const profile = hardware()
      return store.catalog && profile ? recommend(store.catalog, profile) : undefined
    })

    return { api, store, hardware, recommendation }
  },
})

/** The backend models will run on: a faster build still being fetched counts, since it takes over once ready. */
function runningBackend(state: LocalModelsState): EngineBackend {
  const upgrade = state.engineUpgrade
  if (upgrade && "backend" in upgrade) return upgrade.backend
  if (state.engine.status === "ready") return state.engine.backend
  return "vulkan"
}
