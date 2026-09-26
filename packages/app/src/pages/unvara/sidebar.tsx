import { createMemo, For, Show, type JSX } from "solid-js"
import { useCommand } from "@/context/command"
import { useLanguage } from "@/context/language"
import { useLayout } from "@/context/layout"
import { useSettingsDialog } from "@/components/settings-dialog"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeProjectsController } from "@/pages/home/home-projects-controller"
import { createHomeSessionsController } from "@/pages/home/home-sessions-controller"
import { displayName } from "@/pages/layout/helpers"
import { useOpenDraft } from "./home"
import { UvIcon } from "./icons"
import { UnvaraWordmark } from "./mark"

const RECENT_LIMIT = 40

// Claude-style navigation rail: 288px, 32px rows, 8px radius, hover 7.5% / selected 15% white overlays.
export function UnvaraSidebar(props: { onCollapse: () => void; header: JSX.Element }) {
  const language = useLanguage()
  const command = useCommand()
  const layout = useLayout()
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const sessions = createHomeSessionsController(home)
  const openModels = useSettingsDialog("models")
  const openDraft = useOpenDraft()

  const route = () => layout.route()
  const recents = createMemo(() => sessions.data.records().slice(0, RECENT_LIMIT))
  const creating = () => route().type === "draft" || route().type === "home"

  const newChat = () => {
    const conn = home.server.focused()
    const project = home.project.newSession()
    if (!conn) return
    if (project) return openDraft(conn, project.worktree)
    projects.project.choose(conn)
  }

  const addProject = () => {
    const conn = home.server.focused()
    if (conn) projects.project.choose(conn)
  }

  command.register("unvara-shell", () => [
    {
      id: "tab.new",
      category: language.t("command.category.session"),
      title: language.t("unvara.sidebar.newChat"),
      keybind: "mod+n,mod+t",
      onSelect: newChat,
    },
    {
      id: "common.goBack",
      title: language.t("common.goBack"),
      category: language.t("command.category.view"),
      keybind: "mod+[",
      onSelect: () => history.back(),
    },
    {
      id: "common.goForward",
      title: language.t("common.goForward"),
      category: language.t("command.category.view"),
      keybind: "mod+]",
      onSelect: () => history.forward(),
    },
  ])

  return (
    <aside
      data-component="unvara-sidebar"
      class="relative flex h-full w-(--uv-sidebar-width) shrink-0 flex-col bg-v2-background-bg-deep text-v2-text-text-muted"
    >
      <div data-tauri-drag-region class="flex h-(--uv-header-height) shrink-0 items-center gap-1 pl-3 pr-2">
        {props.header}
      </div>

      <nav class="flex flex-col px-2">
        <Row
          icon={<UvIcon.NewChat />}
          label={language.t("unvara.sidebar.newChat")}
          hint={command.keybind("tab.new")}
          selected={creating()}
          strong
          onClick={newChat}
        />
        <Row
          icon={<UvIcon.Search />}
          label={language.t("unvara.sidebar.search")}
          hint={command.keybind("command.palette")}
          onClick={() => command.trigger("command.palette")}
        />
        <Row icon={<UvIcon.Models />} label={language.t("unvara.sidebar.models")} onClick={openModels} />
        <Row
          icon={<UvIcon.Customize />}
          label={language.t("unvara.sidebar.customize")}
          onClick={() => projects.utility.settings()}
        />
      </nav>

      <div class="uv-scroll mt-2 flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
        <Group label={language.t("unvara.sidebar.projects")} actionLabel={language.t("unvara.sidebar.addProject")} onAction={addProject}>
          <For
            each={home.project.list()}
            fallback={<Row icon={<UvIcon.FolderPlus />} label={language.t("unvara.sidebar.addProject")} muted onClick={addProject} />}
          >
            {(project) => (
              <Row
                icon={<UvIcon.Folder />}
                label={displayName(project)}
                onClick={() => {
                  const conn = home.server.focused()
                  if (conn) openDraft(conn, project.worktree)
                }}
              />
            )}
          </For>
        </Group>

        <Group label={language.t("unvara.sidebar.recents")}>
          <For each={recents()} fallback={<p class="px-2.5 py-1.5 text-[13px] text-v2-text-text-faint">{language.t("unvara.sidebar.empty")}</p>}>
            {(record) => (
              <Row
                label={record.session.title || language.t("command.session.new")}
                selected={(() => {
                  const current = route()
                  return current.type === "session" && current.sessionId === record.session.id
                })()}
                compact
                onClick={() => sessions.session.open(record.session)}
              />
            )}
          </For>
        </Group>
      </div>

      <div class="flex h-14 shrink-0 items-center gap-2.5 border-t border-v2-border-border-muted px-3">
        <div class="flex size-7 shrink-0 items-center justify-center rounded-full bg-v2-background-bg-layer-02 text-[12px] font-[560] text-v2-text-text-base">
          {(home.project.homedir().split(/[\\/]/).filter(Boolean).at(-1) ?? "U").slice(0, 1).toUpperCase()}
        </div>
        <div class="flex min-w-0 flex-1 flex-col leading-tight">
          <span class="truncate text-[13px] font-[500] text-v2-text-text-base">
            {home.project.homedir().split(/[\\/]/).filter(Boolean).at(-1) ?? "Unvara"}
          </span>
          <span class="flex items-center gap-1 text-[12px] text-v2-text-text-faint">
            <span class="size-1.5 rounded-full bg-v2-state-fg-success" />
            {language.t("unvara.sidebar.local")}
          </span>
        </div>
        <IconButton label={language.t("unvara.sidebar.collapse")} onClick={props.onCollapse}>
          <UvIcon.Sidebar />
        </IconButton>
      </div>
    </aside>
  )
}

function Row(props: {
  icon?: JSX.Element
  label: string
  hint?: string
  selected?: boolean
  strong?: boolean
  muted?: boolean
  compact?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-selected={props.selected ? "" : undefined}
      class="group/row flex h-(--uv-row-height) w-full shrink-0 items-center gap-2 rounded-(--uv-radius) px-0.5 text-left text-[14px] leading-[21px] transition-colors duration-(--uv-dur-fast) hover:bg-(--uv-hover) focus-visible:bg-(--uv-hover) focus-visible:outline-none data-[selected]:bg-(--uv-selected) data-[selected]:text-v2-text-text-base"
      classList={{
        "text-v2-text-text-base": !!props.strong,
        "text-v2-text-text-faint": !!props.muted,
        "pl-2.5": !!props.compact,
      }}
      onClick={props.onClick}
    >
      <Show when={props.icon}>
        <span class="flex size-(--uv-leading-slot) shrink-0 items-center justify-center">{props.icon}</span>
      </Show>
      <span class="min-w-0 flex-1 truncate">{props.label}</span>
      <Show when={props.hint}>
        <span class="mr-2 shrink-0 text-[12px] text-v2-text-text-faint opacity-0 transition-opacity duration-(--uv-dur-snap) group-hover/row:opacity-100">
          {props.hint}
        </span>
      </Show>
    </button>
  )
}

function Group(props: { label: string; actionLabel?: string; onAction?: () => void; children: JSX.Element }) {
  return (
    <section class="group/section mt-4 flex flex-col">
      <div class="flex h-7 items-center justify-between pl-2.5 pr-1">
        <span class="text-[13px] text-v2-text-text-faint">{props.label}</span>
        <Show when={props.onAction}>
          <button
            type="button"
            aria-label={props.actionLabel}
            title={props.actionLabel}
            class="flex size-6 items-center justify-center rounded-(--uv-radius-xs) text-v2-icon-icon-muted opacity-0 transition-opacity duration-(--uv-dur-snap) hover:bg-(--uv-hover) hover:text-v2-icon-icon-base group-hover/section:opacity-100 focus-visible:opacity-100"
            onClick={props.onAction}
          >
            <UvIcon.Plus size={16} />
          </button>
        </Show>
      </div>
      {props.children}
    </section>
  )
}

export function IconButton(props: { label: string; onClick: () => void; disabled?: boolean; children: JSX.Element }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      class="flex size-8 shrink-0 items-center justify-center rounded-(--uv-radius) text-v2-icon-icon-base transition-colors duration-(--uv-dur-fast) hover:bg-(--uv-hover) hover:text-v2-text-text-base disabled:opacity-40 disabled:hover:bg-transparent"
      onClick={props.onClick}
    >
      {props.children}
    </button>
  )
}

export { UnvaraWordmark }
