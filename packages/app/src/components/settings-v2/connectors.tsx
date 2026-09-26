import { Accessor, Component, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSync } from "@/context/server-sync"
import { useLocalModels } from "@/local-models/context"
import type { Connector } from "@/local-models/types"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"
import "./settings-v2.css"

type Needs = "folder" | "token"

// Popular MCP servers that work without extra setup (besides a folder or token where noted).
const GALLERY: { id: string; connector: Connector; needs?: Needs }[] = [
  {
    id: "files",
    needs: "folder",
    connector: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-filesystem"] },
  },
  { id: "fetch", connector: { type: "local", command: ["uvx", "mcp-server-fetch"] } },
  { id: "search", connector: { type: "local", command: ["uvx", "duckduckgo-mcp-server"] } },
  { id: "browser", connector: { type: "local", command: ["npx", "-y", "@playwright/mcp@latest"] } },
  { id: "memory", connector: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-memory"] } },
  {
    id: "thinking",
    connector: { type: "local", command: ["npx", "-y", "@modelcontextprotocol/server-sequential-thinking"] },
  },
  { id: "github", needs: "token", connector: { type: "remote", url: "https://api.githubcopilot.com/mcp/" } },
]

const STATUS = ["connected", "failed", "needs_auth", "disabled"] as const

/** MCP connectors: the ones added in Unvara, a gallery of ready ones and a custom command or URL. */
export const SettingsConnectors: Component<{ directory: Accessor<string | undefined> }> = (props) => {
  const language = useLanguage()
  const platform = usePlatform()
  const local = useLocalModels()
  const serverSync = useServerSync()
  const [ui, setUi] = createStore({ busy: "", failed: "", token: "", asking: "", name: "", target: "" })
  const connectors = () => local.store.state?.connectors ?? {}

  const status = (name: string) => {
    const dir = props.directory()
    const value = dir ? serverSync().child(dir, { bootstrap: false })[0].mcp[name]?.status : undefined
    return STATUS.find((item) => item === value)
  }

  const add = async (name: string, connector: Connector) => {
    setUi({ busy: name, failed: "" })
    const ready = connector.type === "local" ? await local.api?.ensureConnectorRuntime(connector.command[0]) : true
    if (!ready) return setUi({ busy: "", failed: name })
    await local.api?.setConnector(name, { ...connector, enabled: true })
    setUi({ busy: "", asking: "", token: "" })
  }

  const addFromGallery = async (item: (typeof GALLERY)[number]) => {
    if (item.needs === "token") return setUi("asking", item.id)
    if (item.needs !== "folder") return add(item.id, item.connector)
    if (platform.platform !== "desktop" || item.connector.type !== "local") return
    const picked = await platform.openDirectoryPickerDialog({ title: language.t(`unvara.connectors.${item.id}.title`) })
    const folder = Array.isArray(picked) ? picked[0] : picked
    if (folder) await add(item.id, { ...item.connector, command: [...item.connector.command, folder] })
  }

  const addCustom = async () => {
    const name = ui.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
    const target = ui.target.trim()
    if (!name || !target) return
    await add(
      name,
      /^https?:\/\//i.test(target)
        ? { type: "remote", url: target }
        : { type: "local", command: [...target.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2]) },
    )
    setUi({ name: "", target: "" })
  }

  const installing = () => {
    const runtimes = local.store.state?.runtimes ?? {}
    const entry = (["bun", "uv"] as const).find((runtime) => runtimes[runtime]?.status === "installing")
    const state = entry ? runtimes[entry] : undefined
    if (!entry || state?.status !== "installing") return
    return language.t(`unvara.connectors.installing.${entry}`, {
      percent: state.total ? Math.floor((state.received / state.total) * 100) : 0,
    })
  }

  return (
    <>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("unvara.connectors.title")}</h2>
      </div>
      <div class="settings-v2-tab-body">
        <div class="settings-v2-section">
          <p class="px-1 pb-2 text-[13px] leading-[19px] text-v2-text-text-faint">
            {language.t("unvara.connectors.description")}
          </p>
          <SettingsListV2>
            <For
              each={Object.entries(connectors())}
              fallback={
                <p class="px-3 py-3 text-[13px] text-v2-text-text-faint">{language.t("unvara.connectors.empty")}</p>
              }
            >
              {([name, connector]) => (
                <SettingsRowV2
                  title={name}
                  description={[
                    connector.type === "local" ? connector.command.join(" ") : connector.url,
                    status(name) ? language.t(`mcp.status.${status(name)!}`) : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                >
                  <div class="flex items-center gap-2">
                    <Switch
                      checked={connector.enabled !== false}
                      onChange={(checked) => void local.api?.setConnector(name, { ...connector, enabled: checked })}
                    />
                    <ButtonV2
                      size="normal"
                      variant="neutral"
                      onClick={() => void local.api?.setConnector(name, undefined)}
                    >
                      {language.t("unvara.hub.action.remove")}
                    </ButtonV2>
                  </div>
                </SettingsRowV2>
              )}
            </For>
          </SettingsListV2>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("unvara.connectors.gallery")}</h3>
          <SettingsListV2>
            <For each={GALLERY}>
              {(item) => (
                <SettingsRowV2
                  title={language.t(`unvara.connectors.${item.id}.title`)}
                  description={language.t(`unvara.connectors.${item.id}.description`)}
                >
                  <Show
                    when={ui.asking === item.id}
                    fallback={
                      <ButtonV2
                        size="normal"
                        variant="neutral"
                        disabled={item.id in connectors() || ui.busy !== ""}
                        onClick={() => void addFromGallery(item)}
                      >
                        {language.t(item.id in connectors() ? "unvara.hub.status.installed" : "unvara.connectors.add")}
                      </ButtonV2>
                    }
                  >
                    <div class="flex items-center gap-2">
                      <TextInputV2
                        type="password"
                        appearance="base"
                        placeholder={language.t("unvara.connectors.token")}
                        value={ui.token}
                        onInput={(event) => setUi("token", event.currentTarget.value)}
                      />
                      <ButtonV2
                        size="normal"
                        variant="neutral"
                        disabled={!ui.token.trim()}
                        onClick={() =>
                          item.connector.type === "remote" &&
                          void add(item.id, {
                            ...item.connector,
                            headers: { Authorization: `Bearer ${ui.token.trim()}` },
                          })
                        }
                      >
                        {language.t("unvara.connectors.add")}
                      </ButtonV2>
                    </div>
                  </Show>
                </SettingsRowV2>
              )}
            </For>
          </SettingsListV2>
          <Show when={installing()}>
            {(text) => <p class="px-1 pt-2 text-[13px] text-v2-text-text-faint">{text()}</p>}
          </Show>
          <Show when={ui.failed}>
            <p class="px-1 pt-2 text-[13px] text-(--v2-state-fg-danger)">{language.t("unvara.connectors.failed")}</p>
          </Show>
        </div>

        <div class="settings-v2-section">
          <h3 class="settings-v2-section-title">{language.t("unvara.connectors.custom")}</h3>
          <SettingsListV2>
            <SettingsRowV2
              title={language.t("unvara.connectors.custom.command")}
              description={language.t("unvara.connectors.custom.hint")}
            >
              <div class="flex flex-col gap-2">
                <TextInputV2
                  appearance="base"
                  placeholder={language.t("unvara.connectors.custom.name")}
                  value={ui.name}
                  onInput={(event) => setUi("name", event.currentTarget.value)}
                />
                <TextInputV2
                  appearance="base"
                  placeholder="npx -y @scope/server  ·  https://…"
                  spellcheck={false}
                  value={ui.target}
                  onInput={(event) => setUi("target", event.currentTarget.value)}
                />
                <ButtonV2
                  size="normal"
                  variant="neutral"
                  disabled={!ui.name.trim() || !ui.target.trim() || ui.busy !== ""}
                  onClick={() => void addCustom()}
                >
                  {language.t("unvara.connectors.add")}
                </ButtonV2>
              </div>
            </SettingsRowV2>
          </SettingsListV2>
        </div>
      </div>
    </>
  )
}
