import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import type { LocalProject } from "@/context/layout"
import type { State } from "@/context/global-sync/types"

const sessionQueryDirectories: string[] = []

let SortableWorkspace: typeof import("./sidebar-workspace").SortableWorkspace
let bootSessionLoad: typeof import("./sidebar-workspace").bootSessionLoad

beforeAll(async () => {
  Object.defineProperty(globalThis, "React", {
    configurable: true,
    value: {
      createElement: () => null,
      Fragment: (props: { children?: unknown }) => props.children,
    },
  })

  mock.module("@solidjs/router", () => ({
    useNavigate: () => () => undefined,
    useParams: () => ({}),
  }))

  mock.module("@tanstack/solid-query", () => ({
    useQuery: (options: () => { queryKey?: readonly unknown[] }) => {
      sessionQueryDirectories.push(String(options().queryKey?.[0]))
      return { isLoading: true }
    },
  }))

  mock.module("@/context/global-sync", () => ({
    loadSessionsQuery: (directory: string) => ({ queryKey: [directory, "loadSessions"] }),
    useGlobalSync: () => ({
      child: (directory: string) => {
        return createStore({
          project: "",
          projectMeta: undefined,
          icon: undefined,
          provider_ready: false,
          provider: { all: [], connected: [], default: {} },
          config: {},
          path: { state: "", config: "", worktree: "", directory, home: "" },
          status: "loading",
          agent: [],
          command: [],
          session: [],
          sessionTotal: 0,
          session_status: {},
          session_diff: {},
          todo: {},
          limit: 5,
          permission: {},
          question: {},
          mcp_ready: false,
          mcp: {},
          lsp_ready: false,
          lsp: [],
          vcs: undefined,
          message: {},
          part: {},
        } satisfies State)
      },
      project: {
        loadSessions: () => Promise.resolve(),
      },
    }),
  }))

  mock.module("@/context/language", () => ({
    useLanguage: () => ({
      t: (key: string) => key,
    }),
  }))

  mock.module("@thisbeyond/solid-dnd", () => ({
    createSortable: () => ({ isActiveDraggable: false }),
  }))

  mock.module("@solid-primitives/media", () => ({
    createMediaQuery: () => () => false,
  }))

  mock.module("@opencode-ai/core/util/encode", () => ({
    base64Encode: (value: string) => value,
  }))

  mock.module("@opencode-ai/ui/button", () => ({ Button: (props: { children?: unknown }) => props.children }))
  mock.module("@opencode-ai/ui/icon", () => ({ Icon: () => null }))
  mock.module("@opencode-ai/ui/icon-button", () => ({ IconButton: () => null }))
  mock.module("@opencode-ai/ui/spinner", () => ({ Spinner: () => null }))
  mock.module("@opencode-ai/ui/tooltip", () => ({ Tooltip: (props: { children?: unknown }) => props.children }))
  mock.module("@opencode-ai/ui/dropdown-menu", () => {
    const DropdownMenu = (props: { children?: unknown }) => props.children
    DropdownMenu.Trigger = (props: { children?: unknown }) => props.children
    DropdownMenu.Portal = (props: { children?: unknown }) => props.children
    DropdownMenu.Content = (props: { children?: unknown }) => props.children
    DropdownMenu.Item = (props: { children?: unknown }) => props.children
    DropdownMenu.ItemLabel = (props: { children?: unknown }) => props.children
    return { DropdownMenu }
  })
  mock.module("@opencode-ai/ui/collapsible", () => {
    const Collapsible = (props: { children?: unknown }) => props.children
    Collapsible.Trigger = (props: { children?: unknown }) => props.children
    Collapsible.Content = (props: { children?: unknown }) => props.children
    return { Collapsible }
  })
  mock.module("./sidebar-items", () => ({
    createDirectoryDirty: () => ({ data: false }),
    NewSessionItem: () => null,
    SessionItem: () => null,
    SessionSkeleton: () => null,
  }))

  const mod = await import("./sidebar-workspace")
  SortableWorkspace = mod.SortableWorkspace
  bootSessionLoad = mod.bootSessionLoad
})

beforeEach(() => {
  sessionQueryDirectories.length = 0
})

describe("SortableWorkspace session loading", () => {
  test("boots workspace sessions with bootstrap child and session load", () => {
    const calls: Array<{ directory: string; options: { bootstrap: true } }> = []
    const loaded: string[] = []

    bootSessionLoad(
      {
        child: (directory, options) => {
          calls.push({ directory, options })
        },
        project: {
          loadSessions: (directory) => {
            loaded.push(directory)
          },
        },
      },
      "/repo/.worktrees/sandbox",
    )

    expect(calls).toEqual([{ directory: "/repo/.worktrees/sandbox", options: { bootstrap: true } }])
    expect(loaded).toEqual(["/repo/.worktrees/sandbox"])
  })

  test("observes the workspace directory session query when a sandbox workspace boots", async () => {
    const project = { id: "project", worktree: "/repo", expanded: true } satisfies LocalProject

    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        SortableWorkspace({
          directory: "/repo/.worktrees/sandbox",
          project,
          sortNow: () => 1,
          ctx: {
            currentDir: () => "/repo/.worktrees/sandbox",
            navList: () => [],
            favoriteSessions: () => [],
            sidebarExpanded: () => true,
            sidebarHovering: () => false,
            clearHoverProjectSoon: () => undefined,
            prefetchSession: () => undefined,
            archiveSession: () => Promise.resolve(),
            workspaceName: () => undefined,
            renameWorkspace: () => undefined,
            editorOpen: () => false,
            openEditor: () => undefined,
            closeEditor: () => undefined,
            setEditor: () => undefined,
            InlineEditor: () => null,
            isBusy: () => false,
            workspaceExpanded: () => true,
            setWorkspaceExpanded: () => undefined,
            showResetWorkspaceDialog: () => undefined,
            showDeleteWorkspaceDialog: () => undefined,
            setScrollContainerRef: () => undefined,
          },
        })
        queueMicrotask(() => {
          dispose()
          resolve()
        })
      })
    })

    expect(sessionQueryDirectories).toContain("/repo/.worktrees/sandbox")
  })
})
