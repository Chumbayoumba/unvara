import { createEffect, createMemo, on, Show, Suspense, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { WindowsAppMenu } from "@/components/windows-app-menu"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useLocalModels } from "@/local-models/context"
import { Persist, persisted } from "@/utils/persist"
import { setV2Toast, ToastRegion } from "@/utils/toast"
import { UvIcon } from "./icons"
import { UnvaraWordmark } from "./mark"
import { UnvaraSetup } from "./setup"
import { IconButton, UnvaraSidebar } from "./sidebar"

// Three native Windows caption buttons at 46px each sit over the top-right corner of the window.
const WINDOWS_CONTROLS_WIDTH = 138

/** The Unvara window shell: Claude-style sidebar + a single content pane. Replaces the tabbed V2 layout. */
export default function UnvaraLayout(props: ParentProps) {
  const platform = usePlatform()
  const command = useCommand()
  const language = useLanguage()
  const [state, setState] = persisted(Persist.global("unvara.shell"), createStore({ collapsed: false }))
  const windows = () => platform.platform === "desktop" && platform.os === "windows"
  const menu = () => platform.platform === "desktop" && (platform.os === "windows" || platform.os === "linux")
  const mac = () => platform.platform === "desktop" && platform.os === "macos"

  createEffect(() => setV2Toast(true))
  useLocalProviderRefresh()
  const localModels = useLocalModels()
  // Desktop only: the first-launch wizard covers the window until it is finished or skipped.
  const setupPending = () => {
    const state = localModels.store.state
    return !!localModels.api && !!state && !state.settings.setupCompletedAt
  }

  command.register("unvara-layout", () => [
    {
      id: "sidebar.toggle",
      title: language.t("command.sidebar.toggle"),
      category: language.t("command.category.view"),
      keybind: "mod+b",
      onSelect: () => setState("collapsed", (value) => !value),
    },
  ])

  const historyButtons = (
    <>
      <IconButton label={language.t("common.goBack")} onClick={() => command.trigger("common.goBack")}>
        <UvIcon.ChevronLeft />
      </IconButton>
      <IconButton label={language.t("common.goForward")} onClick={() => command.trigger("common.goForward")}>
        <UvIcon.ChevronRight />
      </IconButton>
    </>
  )

  return (
    <div
      data-component="unvara-shell"
      class="relative flex min-h-0 min-w-0 flex-1 flex-row bg-v2-background-bg-base text-v2-text-text-base select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable]]:select-text"
    >
      <div classList={{ hidden: state.collapsed, "flex h-full": !state.collapsed }}>
        <UnvaraSidebar
          onCollapse={() => setState("collapsed", true)}
          header={
            <>
              <Show when={mac()}>
                <div class="w-[68px] shrink-0" />
              </Show>
              <Show when={menu()}>
                <WindowsAppMenu command={command} platform={platform} variant="v2" />
              </Show>
              <UnvaraWordmark class="ml-1 min-w-0" />
              <div class="flex-1" />
              {historyButtons}
            </>
          }
        />
      </div>

      <div class="relative flex min-w-0 flex-1 flex-col border-l border-v2-border-border-muted bg-v2-background-bg-base">
        <header
          data-tauri-drag-region
          class="flex h-(--uv-header-height) shrink-0 items-center gap-1 px-2"
          style={{ "padding-right": windows() ? `${WINDOWS_CONTROLS_WIDTH + 8}px` : undefined }}
        >
          <Show when={state.collapsed}>
            <Show when={mac()}>
              <div class="w-[68px] shrink-0" />
            </Show>
            <IconButton label={language.t("unvara.sidebar.expand")} onClick={() => setState("collapsed", false)}>
              <UvIcon.Sidebar />
            </IconButton>
            <IconButton label={language.t("unvara.sidebar.newChat")} onClick={() => command.trigger("tab.new")}>
              <UvIcon.NewChat />
            </IconButton>
          </Show>
          <div class="flex-1" />
          <div id="opencode-titlebar-right" class="flex shrink-0 items-center justify-end gap-0" />
        </header>
        <main class="flex min-h-0 min-w-0 flex-1 flex-col items-stretch overflow-x-hidden contain-strict">
          <Suspense>{props.children}</Suspense>
        </main>
      </div>
      <Show when={setupPending()}>
        <UnvaraSetup />
      </Show>
      <ToastRegion v2 />
    </div>
  )
}

/**
 * Installed or removed local models reach OpenCode's provider list only when its instances are rebuilt, which
 * interrupts running sessions, so the rebuild waits until no session is working.
 */
function useLocalProviderRefresh() {
  const local = useLocalModels()
  const serverSync = useServerSync()
  const serverSdk = useServerSDK()
  const [refresh, setRefresh] = createStore({ pending: false })
  // OpenCode also takes each model's context limit from the manifest, so a new context counts as a change.
  const models = createMemo(() => local.store.state?.models.map((model) => `${model.id}:${model.context}`).join("\n"))
  const working = () =>
    Object.values(serverSync().session.data.session_status).some((status) => status && status.type !== "idle")

  createEffect(
    on(models, (next, previous) => {
      if (previous !== undefined && next !== previous) setRefresh("pending", true)
    }),
  )
  createEffect(() => {
    if (!refresh.pending || working()) return
    setRefresh("pending", false)
    void serverSdk()
      .client.global.dispose()
      .then(() => serverSync().refreshProviders())
  })
}
