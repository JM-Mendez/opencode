import { Match, Show, Switch, createMemo } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { createQuery } from "@tanstack/solid-query"
import { Tooltip, type TooltipProps } from "@opencode-ai/ui/tooltip"
import { ProgressCircle } from "@opencode-ai/ui/progress-circle"
import { Progress } from "@opencode-ai/ui/progress"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { useDialog } from "@opencode-ai/ui/context/dialog"

import { useFile } from "@/context/file"
import { useLayout } from "@/context/layout"
import { useSync } from "@/context/sync"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useProviders } from "@/hooks/use-providers"
import { getSessionContextMetrics } from "@/components/session/session-context-metrics"
import { useSessionLayout } from "@/pages/session/session-layout"
import { createSessionTabs } from "@/pages/session/helpers"

interface SessionContextUsageProps {
  variant?: "button" | "indicator"
  placement?: TooltipProps["placement"]
}

function openSessionContext(args: {
  view: ReturnType<ReturnType<typeof useLayout>["view"]>
  layout: ReturnType<typeof useLayout>
  tabs: ReturnType<ReturnType<typeof useLayout>["tabs"]>
}) {
  if (!args.view.reviewPanel.opened()) args.view.reviewPanel.open()
  if (args.layout.fileTree.opened() && args.layout.fileTree.tab() !== "all") args.layout.fileTree.setTab("all")
  void args.tabs.open("context")
  args.tabs.setActive("context")
}

function pct(value: number | null | undefined) {
  return Math.max(0, Math.min(100, value ?? 0))
}

function formatResetTime(
  resetsAt: number | null | undefined,
  resetAfterSeconds: number | null | undefined,
  locale: string,
) {
  const value = resetsAt ?? (resetAfterSeconds === null || resetAfterSeconds === undefined ? undefined : Date.now() + resetAfterSeconds * 1000)
  if (value === undefined) return undefined
  const date = new Date(value < 10_000_000_000 ? value * 1000 : value)
  const sameDay = new Date().toDateString() === date.toDateString()
  return new Intl.DateTimeFormat(locale, {
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

function RateWindow(props: {
  label: string
  remainingPercent: number | null
  resetsAt: number | null
  resetAfterSeconds: number | null
}) {
  const language = useLanguage()
  const reset = createMemo(() => formatResetTime(props.resetsAt, props.resetAfterSeconds, language.intl()))
  return (
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center justify-between gap-3 text-12-regular">
        <span class="text-text-base">{props.label}</span>
        <span class="text-text-weak">
          {props.remainingPercent === null ? "Unavailable" : `${Math.round(props.remainingPercent)}% remaining`}
          <Show when={reset()}>{(value) => ` · resets ${value()}`}</Show>
        </span>
      </div>
      <Progress
        value={pct(props.remainingPercent)}
        aria-label={props.label}
        class="[&_[data-slot='progress-track']]:h-1.5 [&_[data-slot='progress-fill']]:bg-icon-interactive-base"
      />
    </div>
  )
}

function UsageDialog(props: { metrics: ReturnType<typeof getSessionContextMetrics>; cost: string }) {
  const language = useLanguage()
  const sdk = useSDK()
  const usage = createQuery(() => ({
    queryKey: ["chatgpt-usage", sdk.directory],
    queryFn: () => sdk.client.provider.chatgpt.usage().then((result) => result.data),
    staleTime: 60_000,
  }))
  const context = createMemo(() => props.metrics.context)
  const contextRemainingPercent = createMemo(() => pct(100 - (context()?.usage ?? 0)))

  return (
    <Dialog
      title="Usage"
      fit
      transition
      class="!fixed !inset-x-2 !bottom-2 !top-auto !w-auto !max-w-none !min-h-0 !rounded-t-xl"
    >
      <div class="flex flex-col gap-5 p-4 pt-0 pb-8">
        <section class="flex flex-col gap-2">
          <div class="flex items-center justify-between gap-3">
            <div class="text-14-medium text-text-strong">Context</div>
            <div class="text-12-regular text-text-weak">{Math.round(contextRemainingPercent())}% remaining</div>
          </div>
          <Progress
            value={pct(contextRemainingPercent())}
            aria-label={language.t("context.usage.usage")}
            class="[&_[data-slot='progress-track']]:h-2"
          />
          <div class="flex items-center justify-between gap-3 text-12-regular text-text-weak">
            <span>
              {context()?.total.toLocaleString(language.intl()) ?? 0} {language.t("context.usage.tokens")}
            </span>
            <Show when={context()?.limit}>
              {(limit) => <span>{limit().toLocaleString(language.intl())} limit</span>}
            </Show>
          </div>
          <div class="flex items-center justify-between gap-3 text-12-regular text-text-weak">
            <span>{context()?.modelLabel ?? "No model usage yet"}</span>
            <span>{props.cost}</span>
          </div>
        </section>

        <section class="flex flex-col gap-3">
          <div class="flex items-center justify-between gap-3">
            <div class="text-14-medium text-text-strong">ChatGPT</div>
            <div class="text-12-regular text-text-weak">
              <Show when={usage.data?.available} fallback={usage.isLoading ? `${language.t("common.loading")}...` : "Unavailable"}>
                {usage.data?.limited ? "Limited" : (usage.data?.plan ?? "Available")}
              </Show>
            </div>
          </div>
          <Show
            when={usage.data?.available}
            fallback={
              <div class="rounded-md border border-border-weak-base bg-surface-base px-3 py-2 text-12-regular text-text-weak">
                {usage.isLoading ? "Loading ChatGPT usage..." : "ChatGPT usage unavailable"}
              </div>
            }
          >
            <div class="flex flex-col gap-3">
              <RateWindow
                label="5h window"
                remainingPercent={usage.data?.primary?.remainingPercent ?? null}
                resetsAt={usage.data?.primary?.resetsAt ?? null}
                resetAfterSeconds={usage.data?.primary?.resetAfterSeconds ?? null}
              />
              <Show when={usage.data?.secondary}>
                {(secondary) => (
                  <RateWindow
                    label="Weekly"
                    remainingPercent={secondary().remainingPercent}
                    resetsAt={secondary().resetsAt}
                    resetAfterSeconds={secondary().resetAfterSeconds}
                  />
                )}
              </Show>
            </div>
          </Show>
        </section>
      </div>
    </Dialog>
  )
}

export function SessionContextUsage(props: SessionContextUsageProps) {
  const sync = useSync()
  const file = useFile()
  const layout = useLayout()
  const language = useLanguage()
  const providers = useProviders()
  const dialog = useDialog()
  const { params, tabs, view } = useSessionLayout()

  const isDesktop = createMediaQuery("(min-width: 768px)")
  const variant = createMemo(() => props.variant ?? "button")
  const tabState = createSessionTabs({
    tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab: (tab) => (tab.startsWith("file://") ? file.tab(tab) : tab),
  })
  const messages = createMemo(() => (params.id ? (sync.data.message[params.id] ?? []) : []))

  const usd = createMemo(
    () =>
      new Intl.NumberFormat(language.intl(), {
        style: "currency",
        currency: "USD",
      }),
  )

  const metrics = createMemo(() => getSessionContextMetrics(messages(), providers.all()))
  const context = createMemo(() => metrics().context)
  const cost = createMemo(() => {
    return usd().format(metrics().totalCost)
  })

  const openContext = () => {
    if (!params.id) return

    if (!isDesktop()) {
      dialog.show(() => <UsageDialog metrics={metrics()} cost={cost()} />)
      return
    }

    if (tabState.activeTab() === "context") {
      tabs().close("context")
      return
    }
    openSessionContext({
      view: view(),
      layout,
      tabs: tabs(),
    })
  }

  const circle = () => (
    <div class="flex items-center justify-center">
      <ProgressCircle size={16} strokeWidth={2} percentage={context()?.usage ?? 0} />
    </div>
  )

  const tooltipValue = () => (
    <div>
      <Show when={context()}>
        {(ctx) => (
          <>
            <div class="flex items-center gap-2">
              <span class="text-text-invert-strong">{ctx().total.toLocaleString(language.intl())}</span>
              <span class="text-text-invert-base">{language.t("context.usage.tokens")}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-text-invert-strong">{ctx().usage ?? 0}%</span>
              <span class="text-text-invert-base">{language.t("context.usage.usage")}</span>
            </div>
          </>
        )}
      </Show>
      <div class="flex items-center gap-2">
        <span class="text-text-invert-strong">{cost()}</span>
        <span class="text-text-invert-base">{language.t("context.usage.cost")}</span>
      </div>
    </div>
  )

  return (
    <Show when={params.id}>
      <Tooltip value={tooltipValue()} placement={props.placement ?? "top"} inactive={!isDesktop()}>
        <Switch>
          <Match when={variant() === "indicator"}>{circle()}</Match>
          <Match when={true}>
            <Button
              type="button"
              variant="ghost"
              class="size-6"
              onClick={openContext}
              aria-label={language.t("context.usage.view")}
            >
              {circle()}
            </Button>
          </Match>
        </Switch>
      </Tooltip>
    </Show>
  )
}
