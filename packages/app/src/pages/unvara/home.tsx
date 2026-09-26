import { createEffect, untrack } from "solid-js"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { ServerConnection } from "@/context/server"
import { type DraftTab, useTabs } from "@/context/tabs"
import { createHomeController } from "@/pages/home/home-controller"
import { createHomeProjectsController } from "@/pages/home/home-projects-controller"
import { UvIcon } from "./icons"
import { UnvaraMark } from "./mark"

/** Opens the chat composer for a folder, reusing its untouched draft instead of piling up new ones. */
export function useOpenDraft() {
  const tabs = useTabs()
  const global = useGlobal()
  return (conn: ServerConnection.Any, directory: string) => {
    const server = ServerConnection.key(conn)
    const ctx = global.ensureServerCtx(conn)
    ctx.projects.open(directory)
    ctx.projects.touch(directory)
    const draft = tabs.store.find(
      (tab): tab is DraftTab => tab.type === "draft" && tab.server === server && tab.directory === directory,
    )
    if (draft) return tabs.select(draft)
    void tabs.newDraft({ server, directory })
  }
}

/** "/" is the new-chat screen, like Claude: jump straight into the composer of the last folder. */
export function UnvaraHome() {
  const language = useLanguage()
  const tabs = useTabs()
  const home = createHomeController()
  const projects = createHomeProjectsController(home)
  const openDraft = useOpenDraft()

  createEffect(() => {
    if (!tabs.ready()) return
    const conn = home.server.focused()
    const project = home.project.newSession()
    if (conn && project) untrack(() => openDraft(conn, project.worktree))
  })

  const choose = () => {
    const conn = home.server.focused()
    if (conn) projects.project.choose(conn)
  }

  return (
    <div class="relative flex size-full flex-col items-center overflow-hidden px-6">
      <div class="absolute inset-x-0 top-[26%] flex justify-center px-6">
        <div class="flex w-full max-w-[672px] flex-col items-center gap-7">
          <h1 class="flex items-center justify-center gap-3 font-(family-name:--font-family-serif) text-[38px] font-[300] leading-[47.5px] tracking-[-0.01em] text-v2-text-text-base">
            <UnvaraMark size={34} />
            <span>{language.t("unvara.welcome.title")}</span>
          </h1>
          <button
            type="button"
            class="group flex w-full items-center gap-4 rounded-(--uv-radius-composer) bg-v2-background-bg-layer-01 p-4 text-left shadow-[0_0_0_1px_var(--v2-border-border-strong),0_4px_20px_rgba(0,0,0,0.075)] transition-shadow duration-(--uv-dur-base) hover:shadow-[0_0_0_1px_rgba(255,255,255,0.3),0_4px_20px_rgba(0,0,0,0.12)]"
            onClick={choose}
          >
            <span class="flex size-10 shrink-0 items-center justify-center rounded-(--uv-radius-lg) bg-v2-background-bg-layer-02 text-v2-icon-icon-base">
              <UvIcon.FolderPlus />
            </span>
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="text-[15px] font-[500] text-v2-text-text-base">{language.t("unvara.welcome.action")}</span>
              <span class="text-[13px] leading-[19px] text-v2-text-text-faint">{language.t("unvara.welcome.body")}</span>
            </span>
            <UvIcon.ChevronRight class="shrink-0 text-v2-icon-icon-muted transition-transform duration-(--uv-dur-base) group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
