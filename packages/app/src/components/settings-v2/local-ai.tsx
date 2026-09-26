import { Component, createMemo, Show } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useLocalModels } from "@/local-models/context"
import type { EngineBackend } from "@/local-models/types"
import { hardwareSummary } from "@/pages/unvara/hub"
import { backendName, engineStatus } from "@/pages/unvara/setup"
import { showToast } from "@/utils/toast"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

const MIRRORS = ["https://huggingface.co", "https://hf-mirror.com"]
const BACKENDS = ["auto", "cuda-13.4", "cuda-12.4", "vulkan", "cpu"] as const satisfies readonly (
  | EngineBackend
  | "auto"
)[]
const IDLE_MINUTES = [5, 15, 60, 0]

/** Local AI: where models live and download from, which engine runs them, and when VRAM is given back. */
export const SettingsLocalAI: Component = () => {
  const language = useLanguage()
  const platform = usePlatform()
  const local = useLocalModels()
  const state = () => local.store.state
  const settings = () => state()?.settings

  const backends = createMemo(() =>
    BACKENDS.map((value) => ({
      value,
      label: value === "auto" ? language.t("unvara.settings.engine.auto") : backendName(value),
    })),
  )
  const idle = createMemo(() =>
    IDLE_MINUTES.map((value) => ({
      value,
      label:
        value === 0
          ? language.t("unvara.settings.idle.never")
          : value === 60
            ? language.t("unvara.settings.idle.hour")
            : language.t("unvara.settings.idle.minutes", { count: value }),
    })),
  )
  const mirrors = () => MIRRORS.map((value) => ({ value, label: new URL(value).hostname }))

  const changeFolder = async () => {
    if (platform.platform !== "desktop") return
    const picked = await platform.openDirectoryPickerDialog({ title: language.t("unvara.setup.folder.pick") })
    const dir = Array.isArray(picked) ? picked[0] : picked
    if (!dir) return
    await local.api
      ?.updateSettings({ modelsDir: dir })
      .catch(() => showToast({ title: language.t("unvara.setup.folder.error") }))
  }

  const device = () => {
    const engine = state()?.engine
    return engine?.status === "ready" ? engine.device?.name : undefined
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("unvara.settings.localAi.title")}</h2>
      </div>

      <div class="settings-v2-tab-body">
        <Show when={local.api} fallback={<p>{language.t("unvara.hub.unavailable")}</p>}>
          <div class="settings-v2-section">
            <SettingsListV2>
              <SettingsRowV2
                title={language.t("unvara.settings.hardware.title")}
                description={hardwareSummary(language, state()?.system)}
              >
                <ButtonV2 size="normal" variant="neutral" onClick={() => void local.api?.scanHardware()}>
                  {language.t("unvara.hub.hardware.rescan")}
                </ButtonV2>
              </SettingsRowV2>

              <SettingsRowV2
                title={language.t("unvara.settings.engine.title")}
                description={[engineStatus(language, state()?.engine, state()?.engineUpgrade), device()]
                  .filter(Boolean)
                  .join(" · ")}
              >
                <SelectV2
                  appearance="inline"
                  options={backends()}
                  placement="bottom-end"
                  gutter={6}
                  current={backends().find((option) => option.value === (settings()?.backend ?? "auto"))}
                  value={(option) => option.value}
                  label={(option) => option.label}
                  onSelect={(option) => option && void local.api?.setBackend(option.value)}
                />
              </SettingsRowV2>

              <SettingsRowV2
                title={language.t("unvara.settings.idle.title")}
                description={language.t("unvara.settings.idle.description")}
              >
                <SelectV2
                  appearance="inline"
                  options={idle()}
                  placement="bottom-end"
                  gutter={6}
                  current={idle().find((option) => option.value === (settings()?.idleMinutes ?? 15))}
                  value={(option) => String(option.value)}
                  label={(option) => option.label}
                  onSelect={(option) => option && void local.api?.updateSettings({ idleMinutes: option.value })}
                />
              </SettingsRowV2>
            </SettingsListV2>
          </div>

          <div class="settings-v2-section">
            <h3 class="settings-v2-section-title">{language.t("unvara.settings.section.downloads")}</h3>
            <SettingsListV2>
              <SettingsRowV2 title={language.t("unvara.setup.hw.folder")} description={settings()?.modelsDir ?? ""}>
                <ButtonV2 size="normal" variant="neutral" onClick={changeFolder}>
                  {language.t("unvara.settings.folder.change")}
                </ButtonV2>
              </SettingsRowV2>

              <SettingsRowV2
                title={language.t("unvara.settings.mirror.title")}
                description={language.t("unvara.settings.mirror.description")}
              >
                <SelectV2
                  appearance="inline"
                  options={mirrors()}
                  placement="bottom-end"
                  gutter={6}
                  current={mirrors().find((option) => option.value === settings()?.mirror)}
                  value={(option) => option.value}
                  label={(option) => option.label}
                  onSelect={(option) => option && void local.api?.updateSettings({ mirror: option.value })}
                />
              </SettingsRowV2>

              <SettingsRowV2
                title={language.t("unvara.settings.token.title")}
                description={language.t("unvara.settings.token.description")}
              >
                <TextInputV2
                  type="password"
                  appearance="base"
                  value={settings()?.hfToken ?? ""}
                  placeholder="hf_…"
                  spellcheck={false}
                  autocomplete="off"
                  onChange={(event) =>
                    void local.api?.updateSettings({ hfToken: event.currentTarget.value.trim() || undefined })
                  }
                />
              </SettingsRowV2>
            </SettingsListV2>
          </div>
        </Show>
      </div>
    </>
  )
}
