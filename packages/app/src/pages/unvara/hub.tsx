import { For, Match, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import type { CatalogModel } from "@/local-models/catalog"
import { useLocalModels } from "@/local-models/context"
import { primaryGpu, type Fit, type Tier } from "@/local-models/fit"
import { agentReady, tierRank, type ModelFit } from "@/local-models/recommend"
import type { DownloadJob } from "@/local-models/types"
import { HubSearch } from "./hub-search"
import { UvIcon } from "./icons"
import { IconButton } from "./sidebar"

const GIB = 1024 ** 3
// Same reserves the fit engine keeps free for Windows and the app itself.
const RAM_RESERVE = 2 * GIB
const VRAM_RESERVE = 1 * GIB
const TABS = ["forYou", "catalog", "huggingface", "installed", "downloads"] as const
const FILTERS = ["all", "uncensored", "official", "agent", "vision", "fits"] as const
export const SLOTS = ["fast", "balanced", "quality"] as const

type Tab = (typeof TABS)[number]
type Filter = (typeof FILTERS)[number]

const TIER_STYLE: Record<Tier, string> = {
  ideal: "bg-(--v2-state-bg-success) text-(--v2-state-fg-success)",
  good: "bg-(--v2-state-bg-info) text-(--v2-state-fg-info)",
  slow: "bg-(--v2-state-bg-warning) text-(--v2-state-fg-warning)",
  extreme: "bg-(--v2-state-bg-danger) text-(--v2-state-fg-danger)",
  "wont-run": "bg-v2-background-bg-layer-02 text-v2-text-text-faint",
}

export const CARD =
  "rounded-(--uv-radius-card) bg-v2-background-bg-layer-01 shadow-[0_0_0_1px_var(--v2-border-border-muted)]"

/** Models hub: picks for this PC, the full catalog with per-quant fit, installed models and downloads. */
export function UnvaraHub() {
  const language = useLanguage()
  const local = useLocalModels()
  const [ui, setUi] = createStore({ tab: "forYou" as Tab, filter: "all" as Filter, open: "", confirm: "" })

  const state = () => local.store.state
  const pending = () => state()?.downloads.filter((job) => job.status !== "done").length ?? 0
  const count = (tab: Tab) => {
    if (tab === "installed") return state()?.models.length ?? 0
    if (tab === "downloads") return pending()
    return 0
  }

  const catalog = () =>
    (local.recommendation()?.fits ?? [])
      .filter((item) => matches(item, ui.filter))
      .toSorted(
        (a, b) =>
          Number(!a.model.uncensored) - Number(!b.model.uncensored) ||
          tierRank(a.best.fit.tier) - tierRank(b.best.fit.tier),
      )

  return (
    <div class="uv-scroll flex size-full justify-center overflow-y-auto px-6">
      <div class="flex w-full max-w-[880px] flex-col gap-6 pb-16 pt-10">
        <header class="flex flex-wrap items-end justify-between gap-4">
          <div class="flex flex-col gap-1.5">
            <h1 class="font-(family-name:--font-family-serif) text-[32px] font-[300] leading-[40px] tracking-[-0.01em] text-v2-text-text-base">
              {language.t("unvara.hub.title")}
            </h1>
            <p class="text-[14px] text-v2-text-text-faint">{language.t("unvara.hub.subtitle")}</p>
          </div>
          <Show when={local.api}>
            <HardwareChip />
          </Show>
        </header>

        <Show
          when={local.api}
          fallback={<p class="text-[14px] text-v2-text-text-faint">{language.t("unvara.hub.unavailable")}</p>}
        >
          <nav class="flex gap-1 border-b border-v2-border-border-muted">
            <For each={TABS}>
              {(tab) => (
                <button
                  type="button"
                  class="relative -mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-[14px] transition-colors duration-(--uv-dur-fast)"
                  classList={{
                    "border-(--uv-ember) text-v2-text-text-base": ui.tab === tab,
                    "border-transparent text-v2-text-text-faint hover:text-v2-text-text-muted": ui.tab !== tab,
                  }}
                  onClick={() => setUi("tab", tab)}
                >
                  {language.t(`unvara.hub.tab.${tab}`)}
                  <Show when={count(tab)}>
                    <span class="rounded-full bg-v2-background-bg-layer-02 px-1.5 text-[11.5px] leading-[18px] text-v2-text-text-muted">
                      {count(tab)}
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </nav>

          <Switch>
            <Match when={!local.recommendation()}>
              <p class="py-8 text-center text-[14px] text-v2-text-text-faint">
                {language.t("unvara.hub.hardware.scanning")}
              </p>
            </Match>

            <Match when={ui.tab === "forYou"}>
              <div class="flex flex-col gap-4">
                <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <For
                    each={SLOTS.filter((slot) => local.recommendation()?.picks[slot])}
                    fallback={<p class="text-[14px] text-v2-text-text-faint">{language.t("unvara.hub.pick.none")}</p>}
                  >
                    {(slot) => <PickCard slot={slot} item={local.recommendation()!.picks[slot]!} />}
                  </For>
                </div>
                <button
                  type="button"
                  class="group flex items-center gap-1 self-start text-[14px] text-v2-text-text-muted transition-colors hover:text-v2-text-text-base"
                  onClick={() => setUi("tab", "catalog")}
                >
                  {language.t("unvara.hub.browseAll")}
                  <UvIcon.ChevronRight size={16} class="transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>
            </Match>

            <Match when={ui.tab === "catalog"}>
              <div class="flex flex-col gap-4">
                <div class="flex flex-wrap gap-1.5">
                  <For each={FILTERS}>
                    {(filter) => (
                      <button
                        type="button"
                        class="rounded-full px-3 py-1 text-[13px] transition-colors duration-(--uv-dur-fast)"
                        classList={{
                          "bg-v2-text-text-base text-v2-background-bg-base": ui.filter === filter,
                          "bg-v2-background-bg-layer-01 text-v2-text-text-muted shadow-[0_0_0_1px_var(--v2-border-border-muted)] hover:text-v2-text-text-base":
                            ui.filter !== filter,
                        }}
                        onClick={() => setUi("filter", filter)}
                      >
                        {language.t(`unvara.hub.filter.${filter}`)}
                      </button>
                    )}
                  </For>
                </div>
                <For each={catalog()}>
                  {(item) => (
                    <CatalogRow
                      item={item}
                      open={ui.open === item.model.id}
                      onToggle={() => setUi("open", ui.open === item.model.id ? "" : item.model.id)}
                    />
                  )}
                </For>
              </div>
            </Match>

            <Match when={ui.tab === "huggingface"}>
              <HubSearch />
            </Match>

            <Match when={ui.tab === "installed"}>
              <div class="flex flex-col gap-3">
                <For
                  each={state()?.models ?? []}
                  fallback={
                    <p class="text-[14px] text-v2-text-text-faint">{language.t("unvara.hub.empty.installed")}</p>
                  }
                >
                  {(model) => (
                    <div class={`${CARD} flex items-center gap-4 p-4`}>
                      <div class="flex min-w-0 flex-1 flex-col gap-1">
                        <span class="text-[15px] font-[500] text-v2-text-text-base">{model.name}</span>
                        <span class="truncate text-[12.5px] text-v2-text-text-faint">
                          {[
                            model.size ? formatSize(language.intl(), model.size) : undefined,
                            contextLabel(model.context),
                            model.path,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      <Show
                        when={ui.confirm === model.id}
                        fallback={
                          <IconButton
                            label={language.t("unvara.hub.action.remove")}
                            onClick={() => setUi("confirm", model.id)}
                          >
                            <UvIcon.Trash />
                          </IconButton>
                        }
                      >
                        <button
                          type="button"
                          class="rounded-(--uv-radius) bg-(--v2-state-bg-danger) px-3 py-1.5 text-[13px] text-(--v2-state-fg-danger)"
                          onClick={() => {
                            setUi("confirm", "")
                            void local.api?.removeModel(model.id)
                          }}
                        >
                          {language.t("unvara.hub.action.removeConfirm", {
                            size: formatSize(language.intl(), model.size ?? 0),
                          })}
                        </button>
                        <Button onClick={() => setUi("confirm", "")}>{language.t("unvara.hub.action.cancel")}</Button>
                      </Show>
                    </div>
                  )}
                </For>
                <Show when={state()?.settings.modelsDir}>
                  {(dir) => (
                    <p class="text-[12.5px] text-v2-text-text-faint">
                      {language.t("unvara.hub.location", { path: dir() })}
                    </p>
                  )}
                </Show>
              </div>
            </Match>

            <Match when={ui.tab === "downloads"}>
              <div class="flex flex-col gap-3">
                <For
                  each={state()?.downloads.toReversed() ?? []}
                  fallback={
                    <p class="text-[14px] text-v2-text-text-faint">{language.t("unvara.hub.empty.downloads")}</p>
                  }
                >
                  {(job) => <DownloadRow job={job} />}
                </For>
              </div>
            </Match>
          </Switch>
        </Show>
      </div>
    </div>
  )

  function contextLabel(tokens: number) {
    return language.t("unvara.hub.context", { value: Math.round(tokens / 1024) })
  }
}

function HardwareChip() {
  const language = useLanguage()
  const local = useLocalModels()
  const summary = () => {
    const system = local.store.state?.system
    if (!system) return language.t("unvara.hub.hardware.scanning")
    const gpu = primaryGpu(system.gpus)
    const memory = (bytes: number) => formatMemory(language.intl(), bytes)
    return [
      gpu
        ? `${gpu.name.replace(/^(NVIDIA|AMD|Intel\(R\))\s+(GeForce\s+)?/i, "")} · ${language.t("unvara.hub.hardware.vram", { size: memory(gpu.vram) })}`
        : language.t("unvara.hub.hardware.noGpu"),
      language.t("unvara.hub.hardware.ram", { size: memory(system.ram.total) }),
    ].join(" · ")
  }
  return (
    <div class="flex h-9 items-center gap-2 rounded-full bg-v2-background-bg-layer-01 pl-3 pr-0.5 text-[13px] text-v2-text-text-muted shadow-[0_0_0_1px_var(--v2-border-border-muted)]">
      <UvIcon.Chip size={16} class="text-v2-icon-icon-muted" />
      <span>{summary()}</span>
      <IconButton label={language.t("unvara.hub.hardware.rescan")} onClick={() => void local.api?.scanHardware()}>
        <UvIcon.Refresh size={16} />
      </IconButton>
    </div>
  )
}

export function PickCard(props: { slot: (typeof SLOTS)[number]; item: ModelFit; onStart?: (job: string) => void }) {
  const language = useLanguage()
  const best = () => props.item.best
  return (
    <article
      class="flex flex-col gap-4 rounded-(--uv-radius-card) bg-v2-background-bg-layer-01 p-5"
      classList={{
        "shadow-[0_0_0_1px_var(--uv-ember),0_4px_20px_rgba(0,0,0,0.12)]": props.slot === "balanced",
        "shadow-[0_0_0_1px_var(--v2-border-border-muted)]": props.slot !== "balanced",
      }}
    >
      <div class="flex flex-col gap-1">
        <span class="text-[12px] font-[500] uppercase tracking-[0.06em] text-(--uv-ember)">
          {language.t(`unvara.hub.pick.${props.slot}`)}
        </span>
        <h3 class="font-(family-name:--font-family-serif) text-[21px] leading-[28px] text-v2-text-text-base">
          {props.item.model.name}
        </h3>
        <p class="text-[13px] leading-[19px] text-v2-text-text-faint">
          {language.t(`unvara.hub.pick.${props.slot}.hint`)}
        </p>
      </div>
      <Badges model={props.item.model} fit={best().fit} />
      <div class="flex flex-col gap-1.5 text-[13px] text-v2-text-text-muted">
        <div class="flex items-center gap-2">
          <TierPill tier={best().fit.tier} />
          <span>{formatTokens(language, best().fit.tokensPerSecond)}</span>
        </div>
        <span>
          {best().quant.quant} · {formatSize(language.intl(), best().quant.size)}
        </span>
        <span>
          {language.t("unvara.hub.context", { value: Math.round(best().fit.context / 1024) })} ·{" "}
          {language.t(`unvara.hub.mode.${best().fit.mode}`)}
        </span>
      </div>
      <CloseAppsHint fit={best().fit} />
      <div class="mt-auto">
        <ModelAction model={props.item.model} quant={best().quant.quant} primary onStart={props.onStart} />
      </div>
    </article>
  )
}

export function CatalogRow(props: { item: ModelFit; open: boolean; onToggle: () => void }) {
  const language = useLanguage()
  const best = () => props.item.best
  const description = () =>
    (props.item.model.description as Record<string, string>)[language.locale()] ?? props.item.model.description.en
  return (
    <div class={CARD}>
      <div class="flex items-start gap-4 p-4">
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-[15px] font-[500] text-v2-text-text-base">{props.item.model.name}</h3>
            <Badges model={props.item.model} fit={best().fit} />
          </div>
          <Show when={description()}>
            <p class="text-[13px] leading-[19px] text-v2-text-text-faint">{description()}</p>
          </Show>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-v2-text-text-muted">
            <TierPill tier={best().fit.tier} />
            <Show when={best().fit.tier !== "wont-run"}>
              <span>{formatTokens(language, best().fit.tokensPerSecond)}</span>
            </Show>
            <span>
              {best().quant.quant} · {formatSize(language.intl(), best().quant.size)}
            </span>
            <button
              type="button"
              class="flex items-center gap-0.5 text-v2-text-text-muted hover:text-v2-text-text-base"
              onClick={props.onToggle}
            >
              {language.t("unvara.hub.action.details")}
              <UvIcon.ChevronDown
                size={14}
                class={props.open ? "rotate-180 transition-transform" : "transition-transform"}
              />
            </button>
          </div>
          <CloseAppsHint fit={best().fit} />
        </div>
        <ModelAction model={props.item.model} quant={best().quant.quant} />
      </div>
      <Show when={props.open}>
        <table class="w-full border-t border-v2-border-border-muted text-left text-[12.5px]">
          <thead class="text-v2-text-text-faint">
            <tr>
              <th class="px-4 py-2 font-[400]">{language.t("unvara.hub.quant.name")}</th>
              <th class="px-2 py-2 font-[400]">{language.t("unvara.hub.quant.size")}</th>
              <th class="px-2 py-2 font-[400]">{language.t("unvara.hub.quant.fit")}</th>
              <th class="px-2 py-2 font-[400]">{language.t("unvara.hub.quant.speed")}</th>
              <th class="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            <For each={props.item.quants}>
              {(quant) => (
                <tr class="border-t border-v2-border-border-muted text-v2-text-text-muted">
                  <td class="px-4 py-2">
                    <span class="text-v2-text-text-base">{quant.quant.quant}</span>
                    <Show when={quant === best()}>
                      <span class="ml-2 text-(--uv-ember)">{language.t("unvara.hub.badge.recommended")}</span>
                    </Show>
                  </td>
                  <td class="px-2 py-2">{formatSize(language.intl(), quant.quant.size)}</td>
                  <td class="px-2 py-2">
                    <TierPill tier={quant.fit.tier} />
                  </td>
                  <td class="px-2 py-2">
                    <Show when={quant.fit.tier !== "wont-run"}>
                      {formatTokens(language, quant.fit.tokensPerSecond)}
                    </Show>
                  </td>
                  <td class="px-4 py-2 text-right">
                    <ModelAction model={props.item.model} quant={quant.quant.quant} compact />
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  )
}

/** Download button, live progress, or "Installed", for one quant of a catalog model. */
function ModelAction(props: {
  model: CatalogModel
  quant: string
  primary?: boolean
  compact?: boolean
  onStart?: (job: string) => void
}) {
  const language = useLanguage()
  const local = useLocalModels()
  const id = () => `${props.model.id}@${props.quant}`
  const installed = () =>
    local.store.state?.models.some(
      (model) => model.source?.catalogId === props.model.id && model.source.quant === props.quant,
    )
  const job = () => local.store.state?.downloads.find((item) => item.id === id() && item.status !== "done")
  return (
    <Switch
      fallback={
        <Button
          primary={props.primary}
          compact={props.compact}
          onClick={() => void local.api?.download(props.model.id, props.quant).then((job) => props.onStart?.(job))}
        >
          <UvIcon.Download size={16} />
          <Show when={!props.compact}>{language.t("unvara.hub.action.download")}</Show>
        </Button>
      }
    >
      <Match when={installed()}>
        <span class="inline-flex items-center gap-1 text-[13px] text-(--v2-state-fg-success)">
          <UvIcon.Check size={16} />
          <Show when={!props.compact}>{language.t("unvara.hub.status.installed")}</Show>
        </span>
      </Match>
      <Match when={job()}>
        {(job) => (
          <span class="inline-flex items-center gap-2 text-[12.5px] text-v2-text-text-muted">
            <span class="relative h-1.5 w-16 overflow-hidden rounded-full bg-v2-background-bg-layer-02">
              <span
                class="absolute inset-y-0 left-0 rounded-full bg-(--uv-ember)"
                style={{ width: `${percent(job())}%` }}
              />
            </span>
            {percent(job())}%
          </span>
        )}
      </Match>
    </Switch>
  )
}

export function DownloadRow(props: { job: DownloadJob }) {
  const language = useLanguage()
  const local = useLocalModels()
  const intl = () => language.intl()
  const status = () => {
    const job = props.job
    if (job.status === "failed") return language.t(`unvara.hub.error.${job.error?.code ?? "unknown"}`)
    if (job.status === "downloading")
      return [
        language.t("unvara.hub.progress", {
          received: formatSize(intl(), job.received),
          total: formatSize(intl(), job.total),
        }),
        job.speed ? formatSpeed(intl(), job.speed) : undefined,
        job.speed ? eta(job) : undefined,
      ]
        .filter(Boolean)
        .join(" · ")
    return language.t(`unvara.hub.status.${job.status}`)
  }
  const eta = (job: DownloadJob) => {
    const seconds = (job.total - job.received) / job.speed
    if (seconds < 45) return language.t("unvara.hub.eta.soon")
    const minutes = Math.max(1, Math.round(seconds / 60))
    if (minutes < 60) return language.t("unvara.hub.eta.minutes", { minutes })
    return language.t("unvara.hub.eta.hours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
  }
  return (
    <div class={`${CARD} flex items-center gap-4 p-4`}>
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <div class="flex items-baseline justify-between gap-3">
          <span class="truncate text-[15px] font-[500] text-v2-text-text-base">
            {props.job.name} <span class="font-[400] text-v2-text-text-faint">{props.job.quant}</span>
          </span>
          <span class="shrink-0 text-[12.5px] text-v2-text-text-muted">{percent(props.job)}%</span>
        </div>
        <span class="relative h-1.5 overflow-hidden rounded-full bg-v2-background-bg-layer-02">
          <span
            class="absolute inset-y-0 left-0 rounded-full transition-[width] duration-(--uv-dur-base)"
            classList={{
              "bg-(--uv-ember)": props.job.status !== "failed",
              "bg-(--v2-state-fg-danger)": props.job.status === "failed",
            }}
            style={{ width: `${percent(props.job)}%` }}
          />
        </span>
        <span
          class="text-[12.5px]"
          classList={{
            "text-(--v2-state-fg-danger)": props.job.status === "failed",
            "text-v2-text-text-faint": props.job.status !== "failed",
          }}
        >
          {status()}
        </span>
      </div>
      <div class="flex shrink-0 items-center gap-0.5">
        <Show when={props.job.status === "downloading" || props.job.status === "queued"}>
          <IconButton
            label={language.t("unvara.hub.action.pause")}
            onClick={() => void local.api?.pauseDownload(props.job.id)}
          >
            <UvIcon.Pause />
          </IconButton>
        </Show>
        <Show when={props.job.status === "paused" || props.job.status === "failed"}>
          <IconButton
            label={language.t(props.job.status === "failed" ? "unvara.hub.action.retry" : "unvara.hub.action.resume")}
            onClick={() => void local.api?.resumeDownload(props.job.id)}
          >
            <UvIcon.Resume />
          </IconButton>
        </Show>
        <Show when={props.job.status !== "installing"}>
          <IconButton
            label={language.t("unvara.hub.action.cancel")}
            onClick={() => void local.api?.cancelDownload(props.job.id)}
          >
            <UvIcon.Close />
          </IconButton>
        </Show>
      </div>
    </div>
  )
}

function Badges(props: { model: CatalogModel; fit: Fit }) {
  const language = useLanguage()
  const badges = () =>
    [
      props.model.uncensored ? "uncensored" : undefined,
      agentReady(props.model, props.fit) ? "agent" : undefined,
      props.model.capabilities.vision ? "vision" : undefined,
      props.model.capabilities.reasoning ? "reasoning" : undefined,
    ].filter((badge) => badge !== undefined)
  return (
    <div class="flex flex-wrap gap-1.5">
      <For each={badges()}>
        {(badge) => (
          <span
            class="rounded-(--uv-radius-xs) px-1.5 py-px text-[11.5px] font-[500]"
            classList={{
              "bg-[color-mix(in_srgb,var(--uv-ember)_16%,transparent)] text-(--uv-ember)": badge === "uncensored",
              "bg-v2-background-bg-layer-02 text-v2-text-text-muted": badge !== "uncensored",
            }}
          >
            {language.t(`unvara.hub.badge.${badge}`)}
          </span>
        )}
      </For>
    </div>
  )
}

function TierPill(props: { tier: Tier }) {
  const language = useLanguage()
  return (
    <span class={`inline-flex items-center rounded-full px-2 py-px text-[12px] font-[500] ${TIER_STYLE[props.tier]}`}>
      {language.t(`unvara.hub.tier.${props.tier}`)}
    </span>
  )
}

/** Plans assume other apps can be closed; when less memory is free right now, say how much to free up. */
function CloseAppsHint(props: { fit: Fit }) {
  const language = useLanguage()
  const local = useLocalModels()
  const shortfall = () => {
    const system = local.store.state?.system
    if (!system || props.fit.tier === "wont-run") return { ram: 0, vram: 0 }
    const gpu = primaryGpu(system.gpus)
    return {
      ram: props.fit.ram - Math.max(0, system.ram.available - RAM_RESERVE),
      vram: gpu?.vramFree === undefined ? 0 : props.fit.vram - Math.max(0, gpu.vramFree - VRAM_RESERVE),
    }
  }
  return (
    <>
      <Show when={shortfall().vram > 0.5 * GIB}>
        <p class="text-[12.5px] leading-[18px] text-(--v2-state-fg-warning)">
          {language.t("unvara.hub.closeAppsGpu", { size: formatMemory(language.intl(), shortfall().vram) })}
        </p>
      </Show>
      <Show when={shortfall().ram > 0.5 * GIB}>
        <p class="text-[12.5px] leading-[18px] text-(--v2-state-fg-warning)">
          {language.t("unvara.hub.closeApps", { size: formatMemory(language.intl(), shortfall().ram) })}
        </p>
      </Show>
    </>
  )
}

export function Button(props: {
  primary?: boolean
  compact?: boolean
  disabled?: boolean
  onClick: () => void
  children: JSX.Element
}) {
  return (
    <button
      type="button"
      class="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-(--uv-radius) text-[13px] font-[500] transition-colors duration-(--uv-dur-snap)"
      classList={{
        "h-8 px-3": !props.compact,
        "size-7": props.compact,
        "bg-(--uv-ember) text-(--uv-on-ember) hover:bg-(--uv-ember-emphasized)": props.primary,
        "bg-v2-background-bg-layer-02 text-v2-text-text-base hover:bg-(--uv-hover)": !props.primary,
        "pointer-events-none opacity-40": props.disabled,
      }}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

function matches(item: ModelFit, filter: Filter) {
  if (filter === "uncensored") return Boolean(item.model.uncensored)
  if (filter === "official") return !item.model.uncensored
  if (filter === "agent") return agentReady(item.model, item.best.fit)
  if (filter === "vision") return item.model.capabilities.vision
  if (filter === "fits") return tierRank(item.best.fit.tier) <= tierRank("slow")
  return true
}

function percent(job: DownloadJob) {
  return job.total ? Math.floor((job.received / job.total) * 100) : 0
}

export function formatSize(locale: string, bytes: number) {
  const gigabytes = bytes >= 1e9
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: gigabytes ? "gigabyte" : "megabyte",
    maximumFractionDigits: gigabytes ? 1 : 0,
  }).format(gigabytes ? bytes / 1e9 : bytes / 1e6)
}

/** RAM and VRAM as the OS labels them: whole binary gigabytes (a "32 GB" PC reports ~31.2 GiB usable). */
export function formatMemory(locale: string, bytes: number) {
  return new Intl.NumberFormat(locale, { style: "unit", unit: "gigabyte", maximumFractionDigits: 0 }).format(
    Math.max(1, Math.ceil(bytes / GIB - 0.1)),
  )
}

function formatSpeed(locale: string, bytesPerSecond: number) {
  return new Intl.NumberFormat(locale, { style: "unit", unit: "megabyte-per-second", maximumFractionDigits: 1 }).format(
    bytesPerSecond / 1e6,
  )
}

function formatTokens(language: ReturnType<typeof useLanguage>, tokensPerSecond: number) {
  return language.t("unvara.hub.speed", {
    value: tokensPerSecond >= 10 ? Math.round(tokensPerSecond) : tokensPerSecond.toFixed(1),
  })
}
