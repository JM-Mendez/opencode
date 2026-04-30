import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import solidPlugin from "vite-plugin-solid"
// @ts-expect-error Solid's client build subpath is intentionally loaded for Bun tests without browser conditions.
import * as solid from "solid-js/dist/solid.js"

let SessionFollowupDock: typeof import("./session-followup-dock").SessionFollowupDock
let createStore: typeof import("solid-js/store").createStore
let render: typeof import("solid-js/web").render

function installReactCreateElementShim(createElement: typeof import("solid-js/h").default) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "React")
  if (descriptor && !descriptor.configurable && descriptor.writable !== true) return

  Object.defineProperty(globalThis, "React", {
    configurable: descriptor?.configurable ?? true,
    writable: true,
    value: { createElement },
  })
}

async function importClientSolidModules() {
  const solidUrl = import.meta.resolve("solid-js/dist/solid.js")
  const storeUrl = URL.createObjectURL(
    new Blob(
      [
        (await Bun.file(new URL(import.meta.resolve("solid-js/store/dist/store.js"))).text()).replaceAll(
          "from 'solid-js'",
          `from "${solidUrl}"`,
        ),
      ],
      { type: "text/javascript" },
    ),
  )
  const webUrl = URL.createObjectURL(
    new Blob(
      [
        (await Bun.file(new URL(import.meta.resolve("solid-js/web/dist/web.js"))).text()).replaceAll(
          "from 'solid-js'",
          `from "${solidUrl}"`,
        ),
      ],
      { type: "text/javascript" },
    ),
  )

  return {
    solidUrl,
    storeUrl,
    webUrl,
    solidStore: (await import(storeUrl)) as typeof import("solid-js/store"),
    solidWeb: (await import(webUrl)) as typeof import("solid-js/web"),
  }
}

async function importClientH(webUrl: string) {
  return (await import(
    URL.createObjectURL(
      new Blob(
        [
          (await Bun.file(new URL(import.meta.resolve("solid-js/h"))).text()).replaceAll(
            "from 'solid-js/web'",
            `from "${webUrl}"`,
          ),
        ],
        { type: "text/javascript" },
      ),
    )
  )) as { default: typeof import("solid-js/h").default }
}

async function importClientSessionFollowupDock(solidModules: Awaited<ReturnType<typeof importClientSolidModules>>) {
  const transform = solidPlugin({ dev: false, hot: false }).transform
  if (typeof transform !== "function") throw new Error("vite-plugin-solid transform hook is unavailable")

  const componentUrl = new URL("./session-followup-dock.tsx", import.meta.url)
  const transformed = await transform.call(
    {} as never,
    await Bun.file(componentUrl).text(),
    componentUrl.pathname,
    { ssr: false },
  )
  const code = typeof transformed === "string" ? transformed : transformed?.code
  if (!code) throw new Error("vite-plugin-solid did not transform SessionFollowupDock")

  return (await import(
    URL.createObjectURL(
      new Blob(
        [
          new Bun.Transpiler({ loader: "tsx" })
            .transformSync(code)
            .replaceAll('from "solid-js"', `from "${solidModules.solidUrl}"`)
            .replaceAll('from "solid-js/store"', `from "${solidModules.storeUrl}"`)
            .replaceAll('from "solid-js/web"', `from "${solidModules.webUrl}"`)
            .replaceAll("from 'solid-js'", `from "${solidModules.solidUrl}"`)
            .replaceAll("from 'solid-js/store'", `from "${solidModules.storeUrl}"`)
            .replaceAll("from 'solid-js/web'", `from "${solidModules.webUrl}"`),
        ],
        { type: "text/javascript" },
      ),
    )
  )) as typeof import("./session-followup-dock")
}

beforeAll(async () => {
  mock.module("solid-js", () => solid)

  const solidModules = await importClientSolidModules()
  const solidStore = solidModules.solidStore
  const solidWeb = solidModules.solidWeb
  mock.module("solid-js/store", () => solidStore)
  mock.module("solid-js/web", () => solidWeb)

  const h = (await importClientH(solidModules.webUrl)).default
  createStore = solidStore.createStore
  render = solidWeb.render
  installReactCreateElementShim(h)

  mock.module("@opencode-ai/ui/button", () => ({
    Button: (props: { children?: unknown; disabled?: boolean; onClick?: () => void }) =>
      h("button", { disabled: props.disabled, onClick: props.onClick }, props.children),
  }))
  mock.module("@opencode-ai/ui/dock-surface", () => ({
    DockTray: (props: { children?: unknown; "data-component"?: string }) =>
      h("div", { "data-component": props["data-component"] }, props.children),
  }))
  mock.module("@opencode-ai/ui/icon-button", () => ({
    IconButton: (props: {
      "aria-label"?: string
      "data-collapsed"?: string
      onClick?: (event: MouseEvent) => void
      onMouseDown?: (event: MouseEvent) => void
    }) =>
      h(
        "button",
        {
          "aria-label": props["aria-label"],
          "data-collapsed": props["data-collapsed"],
          onClick: props.onClick,
          onMouseDown: props.onMouseDown,
        },
        "",
      ),
  }))

  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (key: string, params?: Record<string, string | number | boolean>) => {
        if (key === "session.followupDock.summary.one") return `${params?.count} queued follow-up`
        if (key === "session.followupDock.summary.other") return `${params?.count} queued follow-ups`
        if (key === "session.followupDock.expand") return "Expand follow-ups"
        if (key === "session.followupDock.collapse") return "Collapse follow-ups"
        if (key === "session.followupDock.sendNow") return "Send now"
        if (key === "session.followupDock.edit") return "Edit"
        return key
      },
    }),
  }))

  SessionFollowupDock = (await importClientSessionFollowupDock(solidModules)).SessionFollowupDock
})

afterEach(() => {
  document.body.replaceChildren()
})

describe("SessionFollowupDock", () => {
  test("starts collapsed with a queue preview and collapses again when queued items change", async () => {
    const [store, setStore] = createStore({
      items: [
        { id: "first", text: "Review the rollback-message copy" },
        { id: "second", text: "Then update the follow-up queue" },
      ],
    })
    const root = document.body.appendChild(document.createElement("div"))
    const dispose = render(
      () =>
        SessionFollowupDock({
          get items() {
            return store.items
          },
          onSend: () => {},
          onEdit: () => {},
        }),
      root,
    )

    try {
      expect(root.textContent).toContain("2 queued follow-ups")
      expect(root.textContent).toContain("Review the rollback-message copy")
      expect(root.textContent).not.toContain("Edit")

      const toggle = root.querySelector<HTMLElement>("[role='button']")!
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }))

      expect(root.textContent).toContain("Edit")

      toggle.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }))

      expect(root.textContent).not.toContain("Edit")

      toggle.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: " " }))

      expect(root.textContent).toContain("Edit")

      setStore("items", [{ id: "third", text: "New queued follow-up after rollback" }])

      expect(root.textContent).toContain("1 queued follow-up")
      expect(root.textContent).toContain("New queued follow-up after rollback")
      expect(root.textContent).not.toContain("Edit")
    } finally {
      dispose()
    }
  })
})
