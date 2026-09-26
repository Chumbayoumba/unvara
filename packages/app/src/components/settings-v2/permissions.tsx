import { Component, createMemo, For, Show } from "solid-js"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { useLanguage } from "@/context/language"
import { configQueued, queueConfig, useEffectiveConfig } from "@/pages/unvara/queued-config"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

// OpenCode's built-in defaults when nothing is configured (agent.ts `defaults`).
const TOOLS = [
  { key: "edit", fallback: "allow" },
  { key: "bash", fallback: "allow" },
  { key: "webfetch", fallback: "allow" },
  { key: "external_directory", fallback: "ask" },
] as const
const ACTIONS = ["ask", "allow", "deny"] as const

type Action = (typeof ACTIONS)[number]

/** What the agent may do without asking. Chat mode never gets tools, whatever is set here. */
export const SettingsPermissions: Component = () => {
  const language = useLanguage()
  const config = useEffectiveConfig()
  // `permission` is either one action for every tool or per-tool rules.
  const permission = () => {
    const value = config().permission
    if (typeof value === "string") return { "*": value }
    return value ?? {}
  }
  const options = createMemo(() =>
    ACTIONS.map((value) => ({ value, label: language.t(`unvara.permissions.action.${value}`) })),
  )
  // Pattern maps (e.g. per-folder rules) set by hand in the config file are shown as custom and left alone.
  const current = (key: string, fallback: Action) => {
    const rules: Record<string, unknown> = permission()
    const value = rules[key] ?? rules["*"]
    if (value === undefined) return fallback
    return typeof value === "string" ? (value as Action) : undefined
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("unvara.permissions.title")}</h2>
      </div>
      <div class="settings-v2-tab-body">
        <div class="settings-v2-section">
          <p class="px-1 pb-2 text-[13px] leading-[19px] text-v2-text-text-faint">
            {language.t("unvara.permissions.description")}
          </p>
          <SettingsListV2>
            <For each={TOOLS}>
              {(tool) => (
                <SettingsRowV2
                  title={language.t(`unvara.permissions.${tool.key}`)}
                  description={language.t(`unvara.permissions.${tool.key}.description`)}
                >
                  <SelectV2
                    appearance="inline"
                    options={options()}
                    placement="bottom-end"
                    gutter={6}
                    current={options().find((option) => option.value === current(tool.key, tool.fallback))}
                    placeholder={language.t("unvara.permissions.custom")}
                    value={(option) => option.value}
                    label={(option) => option.label}
                    onSelect={(option) =>
                      option && queueConfig({ permission: { ...permission(), [tool.key]: option.value } })
                    }
                  />
                </SettingsRowV2>
              )}
            </For>
          </SettingsListV2>
          <Show when={configQueued()}>
            <p class="px-1 pb-2 text-[13px] leading-[19px] text-v2-text-text-faint">
              {language.t("unvara.settings.queued")}
            </p>
          </Show>
        </div>
      </div>
    </>
  )
}
