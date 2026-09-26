import { useNavigate } from "@solidjs/router"
import { For, Match, Show, Switch, type JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { useSettingsDialog } from "@/components/settings-dialog"
import { useLanguage } from "@/context/language"
import { useModels } from "@/context/models"
import { usePlatform } from "@/context/platform"
import { useLocalModels } from "@/local-models/context"
import { primaryGpu } from "@/local-models/fit"
import { LOCAL_PROVIDER_ID, type EngineState, type ImportSource } from "@/local-models/types"
import { Button, DownloadRow, formatMemory, formatSize, PickCard, SLOTS } from "./hub"
import { UvIcon } from "./icons"
import { UnvaraMark } from "./mark"

const GIB = 1024 ** 3
const STEPS = ["welcome", "path", "scan", "pick", "download"] as const
// The scan is fast; a short minimum keeps the "checking" moment from flashing by.
const MIN_SCAN_MS = 1200

type Step = (typeof STEPS)[number] | "import"

/**
 * First-launch wizard over the whole window: welcome and 18+ notice, how to run AI (local / cloud / own files),
 * a look at this PC, the first model and its download. Shown until the user finishes or skips it.
 */
export function UnvaraSetup() {
  const language = useLanguage()
  const local = useLocalModels()
  const platform = usePlatform()
  const models = useModels()
  const navigate = useNavigate()
  const openProviders = useSettingsDialog("providers")
  const [store, setStore] = createStore({
    step: "welcome" as Step,
    adult: false,
    scanning: false,
    folderError: false,
    job: "",
    sources: [] as ImportSource[],
    importing: false,
    imported: -1,
  })
  const state = () => local.store.state
  const job = () => state()?.downloads.find((item) => item.id === store.job)
  const installed = () => {
    const current = job()
    if (!current) return
    return state()?.models.find(
      (model) => model.source?.catalogId === current.catalogId && model.source.quant === current.quant,
    )
  }

  const finish = async (href?: string) => {
    await local.api?.updateSettings({ setupCompletedAt: Date.now() })
    if (href) navigate(href)
  }

  const runLocally = async () => {
    setStore({ step: "scan", scanning: true })
    await Promise.all([local.api?.scanHardware(), new Promise((resolve) => setTimeout(resolve, MIN_SCAN_MS))])
    setStore("scanning", false)
  }

  const connectCloud = async () => {
    await finish()
    openProviders()
  }

  const showImport = async () => {
    setStore({ step: "import", imported: -1, sources: (await local.api?.importSources()) ?? [] })
  }

  const importFrom = async (dir: string) => {
    setStore("importing", true)
    const added = (await local.api?.importFolder(dir)) ?? 0
    setStore({ importing: false, imported: added })
  }

  const chooseImportFolder = async () => {
    const dir = await pickFolder(language.t("unvara.setup.import.choose"))
    if (dir) await importFrom(dir)
  }

  const changeModelsFolder = async () => {
    const dir = await pickFolder(language.t("unvara.setup.folder.pick"))
    if (!dir) return
    const saved = await local.api
      ?.updateSettings({ modelsDir: dir })
      .then(() => true)
      .catch(() => false)
    setStore("folderError", saved === false)
  }

  const pickFolder = async (title: string) => {
    if (platform.platform !== "desktop") return
    const picked = await platform.openDirectoryPickerDialog({ title })
    return Array.isArray(picked) ? picked[0] : (picked ?? undefined)
  }

  const startChat = async () => {
    const model = installed()
    if (model) models.recent.push({ providerID: LOCAL_PROVIDER_ID, modelID: model.id })
    await finish("/")
  }

  return (
    <div class="fixed inset-0 z-40 flex flex-col bg-v2-background-bg-base text-v2-text-text-base">
      <header data-tauri-drag-region class="flex h-(--uv-header-height) shrink-0 items-center justify-center">
        <Show when={store.step !== "import"}>
          <div class="flex gap-1.5">
            <For each={STEPS}>
              {(step) => (
                <span
                  class="h-1.5 rounded-full transition-all duration-(--uv-dur-base)"
                  classList={{
                    "w-5 bg-(--uv-ember)": step === store.step,
                    "w-1.5 bg-v2-background-bg-layer-02": step !== store.step,
                  }}
                />
              )}
            </For>
          </div>
        </Show>
      </header>

      <div class="uv-scroll flex min-h-0 flex-1 justify-center overflow-y-auto px-6">
        <div
          class="flex w-full flex-col gap-8 pb-16 pt-[8vh]"
          classList={{ "max-w-[560px]": store.step !== "pick", "max-w-[880px]": store.step === "pick" }}
        >
          <Switch>
            <Match when={store.step === "welcome"}>
              <Title
                icon={<UnvaraMark size={40} />}
                title={language.t("unvara.setup.welcome.title")}
                body={language.t("unvara.setup.welcome.body")}
              />
              <label class="flex items-center justify-between gap-4 text-[14px]">
                <span class="text-v2-text-text-muted">{language.t("unvara.setup.language")}</span>
                <select
                  class="h-8 rounded-(--uv-radius) bg-v2-background-bg-layer-01 px-2 text-[14px] text-v2-text-text-base shadow-[0_0_0_1px_var(--v2-border-border-muted)]"
                  value={language.locale()}
                  onChange={(event) =>
                    language.setLocale(event.currentTarget.value as (typeof language.locales)[number])
                  }
                >
                  <For each={language.locales}>
                    {(locale) => <option value={locale}>{language.label(locale)}</option>}
                  </For>
                </select>
              </label>
              <label class="flex cursor-pointer items-start gap-3 rounded-(--uv-radius-card) bg-v2-background-bg-layer-01 p-4 text-[14px] leading-[21px] shadow-[0_0_0_1px_var(--v2-border-border-muted)]">
                <input
                  type="checkbox"
                  class="mt-0.5 size-4 shrink-0 accent-(--uv-ember)"
                  checked={store.adult}
                  onChange={(event) => setStore("adult", event.currentTarget.checked)}
                />
                <span class="text-v2-text-text-muted">{language.t("unvara.setup.adult")}</span>
              </label>
              <Actions>
                <Button primary disabled={!store.adult} onClick={() => setStore("step", "path")}>
                  {language.t("unvara.setup.continue")}
                </Button>
              </Actions>
            </Match>

            <Match when={store.step === "path"}>
              <Title title={language.t("unvara.setup.path.title")} />
              <div class="flex flex-col gap-3">
                <Choice
                  title={language.t("unvara.setup.path.local")}
                  body={language.t("unvara.setup.path.local.body")}
                  badge={language.t("unvara.hub.badge.recommended")}
                  onClick={runLocally}
                />
                <Choice
                  title={language.t("unvara.setup.path.cloud")}
                  body={language.t("unvara.setup.path.cloud.body")}
                  onClick={connectCloud}
                />
                <Choice
                  title={language.t("unvara.setup.path.import")}
                  body={language.t("unvara.setup.path.import.body")}
                  onClick={showImport}
                />
              </div>
              <Actions>
                <Button onClick={() => setStore("step", "welcome")}>{language.t("unvara.setup.back")}</Button>
              </Actions>
            </Match>

            <Match when={store.step === "scan"}>
              <Title
                title={language.t(store.scanning ? "unvara.hub.hardware.scanning" : "unvara.setup.scan.title")}
                body={store.scanning ? undefined : verdict()}
              />
              <Show when={!store.scanning && state()?.system}>
                {(system) => (
                  <div class="flex flex-col rounded-(--uv-radius-card) bg-v2-background-bg-layer-01 shadow-[0_0_0_1px_var(--v2-border-border-muted)]">
                    <Row
                      label={language.t("unvara.setup.hw.gpu")}
                      value={(() => {
                        const gpu = primaryGpu(system().gpus)
                        if (!gpu) return language.t("unvara.hub.hardware.noGpu")
                        return `${gpu.name} · ${language.t("unvara.hub.hardware.vram", { size: formatMemory(language.intl(), gpu.vram) })}`
                      })()}
                    />
                    <Row
                      label={language.t("unvara.setup.hw.ram")}
                      value={formatMemory(language.intl(), system().ram.total)}
                    />
                    <Row label={language.t("unvara.setup.hw.cpu")} value={system().cpu.name} />
                    <Row
                      label={language.t("unvara.setup.hw.engine")}
                      value={engineStatus(language, state()?.engine, state()?.engineUpgrade)}
                    />
                    <Row
                      label={language.t("unvara.setup.hw.folder")}
                      value={
                        <span class="flex items-center gap-3">
                          <span class="truncate">
                            {state()?.settings.modelsDir}
                            {(() => {
                              const drive = system().disks.find(
                                (disk) => disk.letter === state()?.settings.modelsDir.slice(0, 1).toUpperCase(),
                              )
                              if (!drive) return ""
                              return ` · ${language.t("unvara.setup.hw.free", { size: formatSize(language.intl(), drive.free) })}`
                            })()}
                          </span>
                          <button
                            type="button"
                            class="shrink-0 text-(--uv-ember) hover:text-(--uv-ember-emphasized)"
                            onClick={changeModelsFolder}
                          >
                            {language.t("unvara.setup.folder.change")}
                          </button>
                        </span>
                      }
                    />
                  </div>
                )}
              </Show>
              <Show when={store.folderError}>
                <p class="text-[13px] text-(--v2-state-fg-danger)">{language.t("unvara.setup.folder.error")}</p>
              </Show>
              <Actions>
                <Button onClick={() => setStore("step", "path")}>{language.t("unvara.setup.back")}</Button>
                <Button primary disabled={store.scanning} onClick={() => setStore("step", "pick")}>
                  {language.t("unvara.setup.continue")}
                </Button>
              </Actions>
            </Match>

            <Match when={store.step === "pick"}>
              <Title title={language.t("unvara.setup.pick.title")} body={language.t("unvara.setup.pick.body")} />
              <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
                <For
                  each={SLOTS.filter((slot) => local.recommendation()?.picks[slot])}
                  fallback={<p class="text-[14px] text-v2-text-text-faint">{language.t("unvara.hub.pick.none")}</p>}
                >
                  {(slot) => (
                    <PickCard
                      slot={slot}
                      item={local.recommendation()!.picks[slot]!}
                      onStart={(id) => setStore({ job: id, step: "download" })}
                    />
                  )}
                </For>
              </div>
              <Actions>
                <Button onClick={() => setStore("step", "scan")}>{language.t("unvara.setup.back")}</Button>
                <Button onClick={() => finish("/models")}>{language.t("unvara.hub.browseAll")}</Button>
              </Actions>
            </Match>

            <Match when={store.step === "download"}>
              <Title
                title={
                  installed()
                    ? language.t("unvara.setup.download.ready", { name: job()?.name ?? "" })
                    : language.t("unvara.setup.download.title", { name: job()?.name ?? "" })
                }
                body={installed() ? undefined : language.t("unvara.setup.download.body")}
              />
              <Show when={job()}>{(current) => <DownloadRow job={current()} />}</Show>
              <Actions>
                <Show
                  when={installed()}
                  fallback={
                    <Button onClick={() => finish("/")}>{language.t("unvara.setup.download.background")}</Button>
                  }
                >
                  <Button primary onClick={startChat}>
                    {language.t("unvara.setup.start")}
                  </Button>
                </Show>
              </Actions>
            </Match>

            <Match when={store.step === "import"}>
              <Title title={language.t("unvara.setup.import.title")} body={language.t("unvara.setup.import.body")} />
              <div class="flex flex-col gap-2">
                <For each={store.sources}>
                  {(source) => (
                    <Choice
                      title={language.t(`unvara.setup.import.${source.app}`)}
                      body={source.path}
                      onClick={() => importFrom(source.path)}
                    />
                  )}
                </For>
                <Choice title={language.t("unvara.setup.import.choose")} onClick={chooseImportFolder} />
              </div>
              <Switch>
                <Match when={store.importing}>
                  <p class="text-[14px] text-v2-text-text-faint">{language.t("unvara.setup.import.working")}</p>
                </Match>
                <Match when={store.imported === 0}>
                  <p class="text-[14px] text-(--v2-state-fg-warning)">{language.t("unvara.setup.import.none")}</p>
                </Match>
                <Match when={store.imported > 0}>
                  <p class="text-[14px] text-(--v2-state-fg-success)">
                    {language.t("unvara.setup.import.added", { count: store.imported })}
                  </p>
                </Match>
              </Switch>
              <Actions>
                <Button onClick={() => setStore("step", "path")}>{language.t("unvara.setup.back")}</Button>
                <Button primary disabled={store.imported <= 0} onClick={() => finish("/")}>
                  {language.t("unvara.setup.continue")}
                </Button>
              </Actions>
            </Match>
          </Switch>

          <button
            type="button"
            class="self-center text-[13px] text-v2-text-text-faint hover:text-v2-text-text-muted"
            onClick={() => finish()}
          >
            {language.t("unvara.setup.skip")}
          </button>
        </div>
      </div>
    </div>
  )

  function verdict() {
    const system = state()?.system
    if (!system) return
    const vram = (primaryGpu(system.gpus)?.vram ?? 0) / GIB
    if (vram >= 15) return language.t("unvara.setup.verdict.great")
    if (vram >= 7.5) return language.t("unvara.setup.verdict.good")
    if (vram >= 3.5 || system.ram.total >= 15 * GIB) return language.t("unvara.setup.verdict.ok")
    return language.t("unvara.setup.verdict.basic")
  }
}

/** "CUDA 13.4, ready", or install progress while a faster engine is being fetched. */
export function engineStatus(
  language: ReturnType<typeof useLanguage>,
  engine: EngineState | undefined,
  upgrade: EngineState | undefined,
) {
  if (upgrade?.status === "downloading")
    return language.t("unvara.setup.engine.installing", {
      backend: backendName(upgrade.backend),
      percent: upgrade.total ? Math.floor((upgrade.received / upgrade.total) * 100) : 0,
    })
  if (upgrade?.status === "testing" || upgrade?.status === "verifying")
    return language.t("unvara.setup.engine.testing", { backend: backendName(upgrade.backend) })
  if (engine?.status === "ready")
    return language.t("unvara.setup.engine.ready", { backend: backendName(engine.backend) })
  return language.t("unvara.setup.engine.preparing")
}

export function backendName(backend: string) {
  if (backend === "cpu") return "CPU"
  if (backend === "vulkan") return "Vulkan"
  return backend.replace("cuda-", "CUDA ")
}

function Title(props: { icon?: JSX.Element; title: string; body?: string }) {
  return (
    <div class="flex flex-col gap-3">
      {props.icon}
      <h1 class="font-(family-name:--font-family-serif) text-[32px] font-[300] leading-[40px] tracking-[-0.01em]">
        {props.title}
      </h1>
      <Show when={props.body}>
        <p class="text-[15px] leading-[23px] text-v2-text-text-muted">{props.body}</p>
      </Show>
    </div>
  )
}

function Choice(props: { title: string; body?: string; badge?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      class="group flex w-full items-center gap-4 rounded-(--uv-radius-card) bg-v2-background-bg-layer-01 p-4 text-left shadow-[0_0_0_1px_var(--v2-border-border-muted)] transition-shadow duration-(--uv-dur-base) hover:shadow-[0_0_0_1px_var(--uv-ember)]"
      onClick={props.onClick}
    >
      <span class="flex min-w-0 flex-1 flex-col gap-1">
        <span class="flex items-center gap-2 text-[15px] font-[500]">
          {props.title}
          <Show when={props.badge}>
            <span class="rounded-(--uv-radius-xs) bg-[color-mix(in_srgb,var(--uv-ember)_16%,transparent)] px-1.5 py-px text-[11.5px] font-[500] text-(--uv-ember)">
              {props.badge}
            </span>
          </Show>
        </span>
        <Show when={props.body}>
          <span class="truncate text-[13px] leading-[19px] text-v2-text-text-faint">{props.body}</span>
        </Show>
      </span>
      <UvIcon.ChevronRight class="shrink-0 text-v2-icon-icon-muted transition-transform duration-(--uv-dur-base) group-hover:translate-x-0.5" />
    </button>
  )
}

function Row(props: { label: string; value: JSX.Element }) {
  return (
    <div class="flex items-center gap-4 border-b border-v2-border-border-muted px-4 py-3 text-[14px] last:border-b-0">
      <span class="w-32 shrink-0 text-v2-text-text-faint">{props.label}</span>
      <span class="min-w-0 flex-1 truncate text-v2-text-text-base">{props.value}</span>
    </div>
  )
}

function Actions(props: { children: JSX.Element }) {
  return <div class="flex items-center justify-end gap-2">{props.children}</div>
}
