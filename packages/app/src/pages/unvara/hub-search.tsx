import { createEffect, For, Match, on, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import type { CatalogModel } from "@/local-models/catalog"
import { useLocalModels } from "@/local-models/context"
import type { HubResult, HubSort } from "@/local-models/huggingface"
import { fitModel } from "@/local-models/recommend"
import { CARD, CatalogRow } from "./hub"
import { UvIcon } from "./icons"

const SORTS = ["downloads", "trending", "recent"] as const satisfies readonly HubSort[]
const SEARCH_DELAY_MS = 400

/** Live Hugging Face search. A result is read (files, quants, GGUF dims) only when opened, then fitted like the catalog. */
export function HubSearch() {
  const language = useLanguage()
  const local = useLocalModels()
  const [store, setStore] = createStore({
    query: "",
    sort: "downloads" as HubSort,
    uncensored: true,
    loading: false,
    failed: false,
    results: [] as HubResult[],
    open: "",
    details: {} as Record<string, CatalogModel | "loading" | "failed">,
  })

  // Debounced search; a newer query wins even if an older request answers later.
  const search = { token: 0 }
  createEffect(
    on(
      () => [store.query, store.sort, store.uncensored] as const,
      ([query, sort, uncensored]) => {
        const token = ++search.token
        const timer = setTimeout(() => {
          setStore({ loading: true, failed: false })
          void local.api
            ?.searchHub(query, sort, uncensored)
            .then((results) => {
              if (token === search.token) setStore({ results, loading: false })
            })
            .catch(() => {
              if (token === search.token) setStore({ results: [], loading: false, failed: true })
            })
        }, SEARCH_DELAY_MS)
        onCleanup(() => clearTimeout(timer))
      },
    ),
  )

  const toggle = (repo: string) => {
    setStore("open", store.open === repo ? "" : repo)
    if (store.details[repo] && store.details[repo] !== "failed") return
    setStore("details", repo, "loading")
    void local.api
      ?.hubDetails(repo)
      .then((model) => setStore("details", repo, model))
      .catch(() => setStore("details", repo, "failed"))
  }

  const compact = (value: number) => new Intl.NumberFormat(language.intl(), { notation: "compact" }).format(value)

  return (
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-2">
        <label class="flex h-9 min-w-[240px] flex-1 items-center gap-2 rounded-(--uv-radius) bg-v2-background-bg-layer-01 px-3 shadow-[0_0_0_1px_var(--v2-border-border-muted)] focus-within:shadow-[0_0_0_1px_var(--uv-ember)]">
          <UvIcon.Search size={16} class="shrink-0 text-v2-icon-icon-muted" />
          <input
            type="search"
            class="min-w-0 flex-1 bg-transparent text-[14px] text-v2-text-text-base outline-none placeholder:text-v2-text-text-faint"
            placeholder={language.t("unvara.hub.search.placeholder")}
            value={store.query}
            onInput={(event) => setStore("query", event.currentTarget.value)}
          />
        </label>
        <div class="flex h-9 items-center rounded-(--uv-radius) bg-v2-background-bg-layer-02 p-0.5 text-[13px]">
          <For each={SORTS}>
            {(sort) => (
              <button
                type="button"
                class="h-8 rounded-(--uv-radius-xs) px-3 transition-colors duration-(--uv-dur-fast)"
                classList={{
                  "bg-v2-background-bg-base text-v2-text-text-base shadow-[0_0_0_1px_var(--v2-border-border-muted)]":
                    store.sort === sort,
                  "text-v2-text-text-faint hover:text-v2-text-text-muted": store.sort !== sort,
                }}
                onClick={() => setStore("sort", sort)}
              >
                {language.t(`unvara.hub.search.sort.${sort}`)}
              </button>
            )}
          </For>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={store.uncensored}
          class="h-9 rounded-full px-3 text-[13px] transition-colors duration-(--uv-dur-fast)"
          classList={{
            "bg-[color-mix(in_srgb,var(--uv-ember)_16%,transparent)] text-(--uv-ember)": store.uncensored,
            "bg-v2-background-bg-layer-01 text-v2-text-text-muted shadow-[0_0_0_1px_var(--v2-border-border-muted)]":
              !store.uncensored,
          }}
          onClick={() => setStore("uncensored", !store.uncensored)}
        >
          {language.t("unvara.hub.filter.uncensored")}
        </button>
      </div>

      <Switch>
        <Match when={store.loading && !store.results.length}>
          <p class="py-6 text-center text-[14px] text-v2-text-text-faint">{language.t("unvara.hub.search.loading")}</p>
        </Match>
        <Match when={store.failed}>
          <p class="py-6 text-center text-[14px] text-(--v2-state-fg-warning)">
            {language.t("unvara.hub.search.error")}
          </p>
        </Match>
        <Match when={!store.results.length}>
          <p class="py-6 text-center text-[14px] text-v2-text-text-faint">{language.t("unvara.hub.search.empty")}</p>
        </Match>
      </Switch>

      <For each={store.results}>
        {(result) => {
          const details = () => store.details[result.repo]
          const fitted = () => {
            const model = details()
            const hardware = local.hardware()
            if (!model || typeof model === "string" || !hardware) return
            return fitModel(model, hardware)
          }
          return (
            <Show
              when={store.open === result.repo && fitted()}
              fallback={
                <div class={CARD}>
                  <button
                    type="button"
                    class="flex w-full items-start gap-4 p-4 text-left"
                    onClick={() => toggle(result.repo)}
                  >
                    <span class="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span class="flex flex-wrap items-center gap-2">
                        <span class="truncate text-[15px] font-[500] text-v2-text-text-base">{result.name}</span>
                        <Show when={result.uncensored}>
                          <span class="rounded-(--uv-radius-xs) bg-[color-mix(in_srgb,var(--uv-ember)_16%,transparent)] px-1.5 py-px text-[11.5px] font-[500] text-(--uv-ember)">
                            {language.t("unvara.hub.badge.uncensored")}
                          </span>
                        </Show>
                      </span>
                      <span class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-v2-text-text-muted">
                        <span>{result.publisher}</span>
                        <Show when={result.paramsTotal}>{(total) => <span>{(total() / 1e9).toFixed(1)}B</span>}</Show>
                        <Show when={result.arch}>{(arch) => <span>{arch()}</span>}</Show>
                        <span class="flex items-center gap-1">
                          <UvIcon.Download size={13} />
                          {compact(result.downloads)}
                        </span>
                      </span>
                      <Switch>
                        <Match when={store.open === result.repo && details() === "loading"}>
                          <span class="text-[12.5px] text-v2-text-text-faint">
                            {language.t("unvara.hub.search.details")}
                          </span>
                        </Match>
                        <Match when={store.open === result.repo && details() === "failed"}>
                          <span class="text-[12.5px] text-(--v2-state-fg-warning)">
                            {language.t("unvara.hub.search.detailsError")}
                          </span>
                        </Match>
                      </Switch>
                    </span>
                    <UvIcon.ChevronDown size={16} class="mt-1 shrink-0 text-v2-icon-icon-muted" />
                  </button>
                </div>
              }
            >
              {(item) => <CatalogRow item={item()} open onToggle={() => setStore("open", "")} />}
            </Show>
          )
        }}
      </For>
    </div>
  )
}
