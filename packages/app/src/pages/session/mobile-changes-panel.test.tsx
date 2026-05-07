import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import solidPlugin from "vite-plugin-solid"
// @ts-expect-error Solid's client build subpath is intentionally loaded for Bun tests without browser conditions.
import * as solid from "solid-js/dist/solid.js"

let MobileChangesPanel: typeof import("./mobile-changes-panel").MobileChangesPanel
let MobileVcsModeToggle: typeof import("./mobile-changes-panel").MobileVcsModeToggle
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

async function importClientMobileChangesPanel(solidModules: Awaited<ReturnType<typeof importClientSolidModules>>) {
  const transform = solidPlugin({ dev: false, hot: false }).transform
  if (typeof transform !== "function") throw new Error("vite-plugin-solid transform hook is unavailable")

  const componentUrl = new URL("./mobile-changes-panel.tsx", import.meta.url)
  const transformed = await transform.call(
    {} as never,
    await Bun.file(componentUrl).text(),
    componentUrl.pathname,
    { ssr: false },
  )
  const code = typeof transformed === "string" ? transformed : transformed?.code
  if (!code) throw new Error("vite-plugin-solid did not transform MobileChangesPanel")

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
  )) as typeof import("./mobile-changes-panel")
}

beforeAll(async () => {
  mock.module("solid-js", () => solid)

  const solidModules = await importClientSolidModules()
  const solidWeb = solidModules.solidWeb
  mock.module("solid-js/store", () => solidModules.solidStore)
  mock.module("solid-js/web", () => solidWeb)

  const h = (await importClientH(solidModules.webUrl)).default
  render = solidWeb.render
  installReactCreateElementShim(h)

  mock.module("@opencode-ai/ui/button", () => ({
    Button: (props: { children?: unknown; class?: string; disabled?: boolean; onClick?: () => void }) =>
      h("button", { class: props.class, disabled: props.disabled, onClick: props.onClick }, props.children),
  }))

  const module = await importClientMobileChangesPanel(solidModules)
  MobileChangesPanel = module.MobileChangesPanel
  MobileVcsModeToggle = module.MobileVcsModeToggle
})

afterEach(() => {
  document.body.replaceChildren()
})

describe("MobileChangesPanel", () => {
  test("renders children in the main area", () => {
    const root = document.body.appendChild(document.createElement("div"))
    const dispose = render(
      () =>
        MobileChangesPanel({
          mode: "unstaged",
          git: true,
          pending: false,
          onStageAll: () => {},
          onUnstageAll: () => {},
          onRevertAll: () => {},
          onCommit: () => {},
          children: "Review rows",
        }),
      root,
    )

    try {
      expect(root.textContent).toContain("Review rows")
      expect(root.textContent).toContain("Stage All")
    } finally {
      dispose()
    }
  })

  test("renders unstaged actions and calls their callbacks", () => {
    const onRevertAll = mock(() => {})
    const onStageAll = mock(() => {})
    const root = document.body.appendChild(document.createElement("div"))
    const dispose = render(
      () =>
        MobileChangesPanel({
          mode: "unstaged",
          git: true,
          pending: false,
          onRevertAll,
          onStageAll,
          onUnstageAll: () => {},
          onCommit: () => {},
          children: "Review rows",
        }),
      root,
    )

    try {
      const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
      const revertAll = buttons.find((button) => button.textContent === "Revert All")
      const stageAll = buttons.find((button) => button.textContent === "Stage All")

      expect(revertAll).toBeDefined()
      expect(stageAll).toBeDefined()

      revertAll!.click()
      stageAll!.click()

      expect(onRevertAll).toHaveBeenCalledTimes(1)
      expect(onStageAll).toHaveBeenCalledTimes(1)
    } finally {
      dispose()
    }
  })

  test("renders staged actions and calls their callbacks", () => {
    const onUnstageAll = mock(() => {})
    const onCommit = mock(() => {})
    const root = document.body.appendChild(document.createElement("div"))
    const dispose = render(
      () =>
        MobileChangesPanel({
          mode: "staged",
          git: true,
          pending: false,
          onRevertAll: () => {},
          onStageAll: () => {},
          onUnstageAll,
          onCommit,
          children: "Review rows",
        }),
      root,
    )

    try {
      const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
      const unstageAll = buttons.find((button) => button.textContent === "Unstage All")
      const commit = buttons.find((button) => button.textContent === "Commit")

      expect(unstageAll).toBeDefined()
      expect(commit).toBeDefined()

      unstageAll!.click()
      commit!.click()

      expect(onUnstageAll).toHaveBeenCalledTimes(1)
      expect(onCommit).toHaveBeenCalledTimes(1)
    } finally {
      dispose()
    }
  })

  test("keeps the footer compact", () => {
    const root = document.body.appendChild(document.createElement("div"))
    const dispose = render(
      () =>
        MobileChangesPanel({
          mode: "unstaged",
          git: true,
          pending: false,
          onRevertAll: () => {},
          onStageAll: () => {},
          onUnstageAll: () => {},
          onCommit: () => {},
          children: "Review rows",
        }),
      root,
    )

    try {
      const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
      expect(buttons.some((button) => button.textContent === "Revert All")).toBe(true)
      expect(buttons.some((button) => button.textContent === "Stage All")).toBe(true)
      expect(buttons.some((button) => button.textContent === "Unstage All")).toBe(false)
      expect(buttons.some((button) => button.textContent === "Commit")).toBe(false)
      expect(root.innerHTML).not.toContain("pb-36")
      expect(root.innerHTML).not.toContain("pb-40")
      expect(root.innerHTML).not.toContain("pb-48")
    } finally {
      dispose()
    }
  })

  test("disables actions when not git, empty, or pending", () => {
    const cases = [
      { mode: "unstaged" as const, git: false, pending: false },
      { mode: "empty" as const, git: true, pending: false },
      { mode: "unstaged" as const, git: true, pending: true },
    ]

    for (const item of cases) {
      const root = document.body.appendChild(document.createElement("div"))
      const dispose = render(
        () =>
          MobileChangesPanel({
            ...item,
            onStageAll: () => {},
            onUnstageAll: () => {},
            onRevertAll: () => {},
            onCommit: () => {},
            children: "Review rows",
          }),
        root,
      )

      try {
        for (const button of root.querySelectorAll<HTMLButtonElement>("button")) {
          expect(button.disabled).toBe(true)
        }
      } finally {
        dispose()
        root.remove()
      }
    }
  })
})

describe("MobileVcsModeToggle", () => {
  test("renders unstaged and staged buttons", () => {
    const root = document.body.appendChild(document.createElement("div"))
    const dispose = render(
      () =>
        MobileVcsModeToggle({
          mode: "unstaged",
          disabled: false,
        }),
      root,
    )

    try {
      const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
      expect(buttons.some((button) => button.textContent === "Unstaged")).toBe(true)
      expect(buttons.some((button) => button.textContent === "Staged")).toBe(true)
    } finally {
      dispose()
    }
  })

  test("reports mode changes", () => {
    const onModeChange = mock((mode: "unstaged" | "staged") => {})
    const root = document.body.appendChild(document.createElement("div"))
    const dispose = render(
      () =>
        MobileVcsModeToggle({
          mode: "unstaged",
          disabled: false,
          onModeChange,
        }),
      root,
    )

    try {
      const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>("button"))
      const stagedToggle = buttons.find((button) => button.textContent === "Staged")

      expect(stagedToggle).toBeDefined()

      stagedToggle!.click()

      expect(onModeChange).toHaveBeenCalledWith("staged")
    } finally {
      dispose()
    }
  })

  test("disabled when explicitly disabled", () => {
    const root = document.body.appendChild(document.createElement("div"))
    const dispose = render(
      () =>
        MobileVcsModeToggle({
          mode: "unstaged",
          disabled: true,
          onModeChange: () => {},
        }),
      root,
    )

    try {
      for (const button of root.querySelectorAll<HTMLButtonElement>("button")) {
        expect(button.disabled).toBe(true)
      }
    } finally {
      dispose()
      root.remove()
    }
  })
})
