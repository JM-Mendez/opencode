import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"

type SettingsContext = ReturnType<typeof import("./settings").useSettings>

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  clear() {
    this.values.clear()
  }

  get length() {
    return this.values.size
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

const storage = new MemoryStorage()

let SettingsProvider: typeof import("./settings").SettingsProvider
let useSettings: typeof import("./settings").useSettings

beforeAll(async () => {
  mock.module("@opencode-ai/ui/context", () => ({
    createSimpleContext: <T, Props extends Record<string, unknown>>(input: { name: string; init: (props: Props) => T }) => {
      let current: T | undefined
      return {
        provider: (props: Props & { children?: unknown }) => {
          current = input.init(props)
          return props.children
        },
        use: () => {
          if (current === undefined) throw new Error(`${input.name} context must be used within a context provider`)
          return current
        },
      }
    },
  }))

  mock.module("@/context/platform", () => ({
    usePlatform: () => ({ platform: "web" }),
  }))

  const mod = await import("./settings")
  SettingsProvider = mod.SettingsProvider
  useSettings = mod.useSettings
})

beforeEach(() => {
  storage.clear()
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  })
})

function Capture(props: { onSettings: (settings: SettingsContext) => void }) {
  props.onSettings(useSettings())
  return null
}

function mountSettings(onSettings: (settings: SettingsContext) => void) {
  return createRoot((dispose) => {
    SettingsProvider({ children: undefined })
    Capture({ onSettings })
    return dispose
  })
}

describe("settings follow-up behavior", () => {
  test("persists and reads queue without coercing steer", async () => {
    let settings: SettingsContext | undefined
    const dispose = mountSettings((value) => {
      settings = value
    })

    settings!.general.setFollowup("steer")
    await Promise.resolve()
    expect(settings!.general.followup()).toBe("steer")

    settings!.general.setFollowup("queue")
    await Promise.resolve()
    expect(settings!.general.followup()).toBe("queue")
    dispose()

    let restored: SettingsContext | undefined
    const disposeRestored = mountSettings((value) => {
      restored = value
    })

    expect(restored!.general.followup()).toBe("queue")
    disposeRestored()
  })
})
