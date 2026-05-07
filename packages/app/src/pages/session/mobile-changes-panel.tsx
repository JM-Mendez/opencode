import { Button } from "@opencode-ai/ui/button"
import type { JSX } from "solid-js"

export function MobileVcsModeToggle(props: {
  mode: "unstaged" | "staged" | "empty"
  disabled?: boolean
  onModeChange?: (mode: "unstaged" | "staged") => void
}) {
  const selectedMode = () => (props.mode === "empty" ? "unstaged" : props.mode)

  return (
    <div class="grid grid-cols-2 gap-1 rounded-lg bg-background-base p-0.5">
      <Button
        variant={selectedMode() === "unstaged" ? "secondary" : "ghost"}
        class="h-8 px-3 text-13-medium"
        disabled={props.disabled}
        onClick={() => props.onModeChange?.("unstaged")}
      >
        Unstaged
      </Button>
      <Button
        variant={selectedMode() === "staged" ? "secondary" : "ghost"}
        class="h-8 px-3 text-13-medium"
        disabled={props.disabled}
        onClick={() => props.onModeChange?.("staged")}
      >
        Staged
      </Button>
    </div>
  )
}

export function MobileChangesPanel(props: {
  children: JSX.Element
  mode: "unstaged" | "staged" | "empty"
  git: boolean
  pending: boolean
  actionsDisabled?: boolean
  onStageAll: () => void
  onUnstageAll: () => void
  onRevertAll: () => void
  onCommit: () => void
}) {
  const selectedMode = () => (props.mode === "empty" ? "unstaged" : props.mode)
  const disabled = () => !props.git || props.pending || props.mode === "empty" || props.actionsDisabled

  return (
    <div class="relative flex h-full flex-col overflow-hidden bg-background-stronger">
      <div class="min-h-0 flex-1 overflow-hidden">{props.children}</div>
      <div class="shrink-0 border-t border-border-weaker-base bg-background-stronger/95 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
        <div class="grid grid-cols-2 gap-3">
          <Button
            variant="ghost"
            class="h-11 px-5 text-14-medium text-text-on-critical-base"
            disabled={disabled()}
            onClick={selectedMode() === "staged" ? props.onUnstageAll : props.onRevertAll}
          >
            {selectedMode() === "staged" ? "Unstage All" : "Revert All"}
          </Button>
          <Button
            variant="primary"
            class="h-11 px-5 text-14-medium"
            disabled={disabled()}
            onClick={selectedMode() === "staged" ? props.onCommit : props.onStageAll}
          >
            {selectedMode() === "staged" ? "Commit" : "Stage All"}
          </Button>
        </div>
      </div>
    </div>
  )
}
