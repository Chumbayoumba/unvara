import { Tooltip } from "@opencode-ai/ui/tooltip"
import { UnvaraMark } from "@/pages/unvara/mark"
import { Show, type Accessor } from "solid-js"
import { Portal } from "solid-js/web"
import { PromptInputV2Composer } from "@/components/prompt-input-v2"
import { PromptGitStatus, PromptWorkspaceSelector } from "@/components/prompt-workspace-selector"
import {
  PromptProjectAddButton,
  PromptProjectSelector,
  type PromptProjectController,
} from "@/components/prompt-project-selector"
import { StatusPopoverV2 } from "@/components/status-popover"
import { useLanguage } from "@/context/language"
import { NEW_SESSION_CONTENT_WIDTH } from "@/pages/session/new-session-layout"
import type { NewSessionDraftController } from "./new-session-draft-controller"
import type { NewSessionWorkspaceController } from "./new-session-workspace-controller"

export function NewSessionView(props: {
  input: NewSessionDraftController["input"]
  project: PromptProjectController
  workspace: NewSessionWorkspaceController
}) {
  return (
    <div class="@container relative flex flex-col min-h-0 h-full flex-1">
      <div
        data-component="session-new-design"
        class="relative flex-1 min-h-0 overflow-hidden"
      >
        <div class="absolute inset-x-0 top-[26%] flex justify-center px-6">
          <div class={NEW_SESSION_CONTENT_WIDTH}>
            <Greeting />
            <div class="mt-7 flex flex-col gap-6">
              <PromptInputV2Composer controller={props.input} />
              <Show when={props.project.empty()}>
                <PromptProjectAddButton controller={props.project} />
              </Show>
              <Show when={props.project.selected()}>
                <div class="flex min-h-7 min-w-0 flex-col items-center justify-center gap-0 text-v2-text-text-faint sm:flex-row">
                  <PromptProjectSelector controller={props.project} placement="bottom" />
                  <Show
                    when={props.workspace.bar.visible()}
                    fallback={
                      <PromptGitStatus branch={props.workspace.bar.branch()} noGit={!props.workspace.project.git()} />
                    }
                  >
                    <PromptWorkspaceSelector
                      value={props.workspace.selection.value()}
                      projectRoot={props.workspace.project.root()}
                      workspaces={props.workspace.project.workspaces()}
                      branch={props.workspace.bar.branch()}
                      onChange={props.workspace.selection.set}
                      onDone={props.input.restoreFocus}
                    />
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Greeting() {
  const language = useLanguage()
  const hour = new Date().getHours()
  const key =
    hour < 5
      ? "unvara.greeting.night"
      : hour < 12
        ? "unvara.greeting.morning"
        : hour < 18
          ? "unvara.greeting.afternoon"
          : "unvara.greeting.evening"

  return (
    <h1 class="flex items-center justify-center gap-3 text-center font-(family-name:--font-family-serif) text-[38px] font-[300] leading-[47.5px] tracking-[-0.01em] text-v2-text-text-base animate-in fade-in slide-in-from-bottom-1 duration-[350ms]">
      <UnvaraMark size={34} class="shrink-0" />
      <span class="min-w-0 truncate">{language.t(key)}</span>
    </h1>
  )
}

export function NewSessionStatus(props: { mount: Accessor<HTMLElement | null>; visible: Accessor<boolean> }) {
  const language = useLanguage()

  return (
    <Show when={props.mount()} keyed>
      {(mount) => (
        <Portal mount={mount}>
          <Show when={props.visible()}>
            <Tooltip placement="bottom" value={language.t("status.popover.trigger")}>
              <StatusPopoverV2 />
            </Tooltip>
          </Show>
        </Portal>
      )}
    </Show>
  )
}

