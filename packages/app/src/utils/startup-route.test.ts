import { describe, expect, test } from "bun:test"
import { persistablePath, resolveStartupPath } from "./startup-route"

describe("resolveStartupPath", () => {
  test("restores a saved in-app path from root", () => {
    expect(resolveStartupPath("/", "/workspace/session/123?tab=files#diff", "https://tail.example.ts.net")).toBe(
      "/workspace/session/123?tab=files#diff",
    )
  })

  test("does not override an explicit non-root URL", () => {
    expect(resolveStartupPath("/workspace/session/123", "/workspace/session/456", "https://tail.example.ts.net")).toBeUndefined()
  })

  test("rejects cross-origin URLs", () => {
    expect(resolveStartupPath("/", "https://example.com/phish", "https://tail.example.ts.net")).toBeUndefined()
  })

  test("ignores saved root path", () => {
    expect(resolveStartupPath("/", "/", "https://tail.example.ts.net")).toBeUndefined()
  })
})

describe("persistablePath", () => {
  test("accepts local paths", () => {
    expect(persistablePath("/workspace/session/123")).toBe(true)
  })

  test("rejects non-path values", () => {
    expect(persistablePath("https://example.com")).toBe(false)
  })
})
