import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Effect, Layer, Context, Stream, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

const cfg = [
  "--no-optional-locks",
  "-c",
  "core.autocrlf=false",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.longpaths=true",
  "-c",
  "core.symlinks=true",
  "-c",
  "core.quotepath=false",
] as const

const out = (result: { text(): string }) => result.text().trim()
const nuls = (text: string) => text.split("\0").filter(Boolean)
const fail = (err: unknown) =>
  ({
    exitCode: 1,
    text: () => "",
    stdout: Buffer.alloc(0),
    stderr: Buffer.from(err instanceof Error ? err.message : String(err)),
  }) satisfies Result

export type Kind = "added" | "deleted" | "modified"

export type Base = {
  readonly name: string
  readonly ref: string
}

export type Item = {
  readonly file: string
  readonly code: string
  readonly status: Kind
}

export type Stat = {
  readonly file: string
  readonly additions: number
  readonly deletions: number
}

export type Tracking = {
  readonly upstream?: string
  readonly ahead: number
  readonly behind: number
}

export class FailedError extends Schema.TaggedErrorClass<FailedError>()("GitFailedError", {
  message: Schema.String,
}) {}

export interface Result {
  readonly exitCode: number
  readonly text: () => string
  readonly stdout: Buffer
  readonly stderr: Buffer
}

export interface Options {
  readonly cwd: string
  readonly env?: Record<string, string>
}

export interface Interface {
  readonly run: (args: string[], opts: Options) => Effect.Effect<Result>
  readonly branch: (cwd: string) => Effect.Effect<string | undefined>
  readonly prefix: (cwd: string) => Effect.Effect<string>
  readonly defaultBranch: (cwd: string) => Effect.Effect<Base | undefined>
  readonly hasHead: (cwd: string) => Effect.Effect<boolean>
  readonly tracking: (cwd: string) => Effect.Effect<Tracking>
  readonly mergeBase: (cwd: string, base: string, head?: string) => Effect.Effect<string | undefined>
  readonly show: (cwd: string, ref: string, file: string, prefix?: string) => Effect.Effect<string>
  readonly showIndex: (cwd: string, file: string, prefix?: string) => Effect.Effect<string>
  readonly status: (cwd: string) => Effect.Effect<Item[]>
  readonly statusStaged: (cwd: string) => Effect.Effect<Item[]>
  readonly statusUnstaged: (cwd: string) => Effect.Effect<Item[]>
  readonly diff: (cwd: string, ref: string) => Effect.Effect<Item[]>
  readonly stats: (cwd: string, ref: string) => Effect.Effect<Stat[]>
  readonly statsCached: (cwd: string, ref?: string) => Effect.Effect<Stat[]>
  readonly statsUnstaged: (cwd: string) => Effect.Effect<Stat[]>
  readonly add: (cwd: string, paths: readonly string[]) => Effect.Effect<void, FailedError>
  readonly unstage: (cwd: string, paths: readonly string[]) => Effect.Effect<void, FailedError>
  readonly revertUnstaged: (cwd: string, paths: readonly string[]) => Effect.Effect<void, FailedError>
  readonly commit: (cwd: string, message: string) => Effect.Effect<void, FailedError>
  readonly push: (cwd: string) => Effect.Effect<void, FailedError>
  readonly pull: (cwd: string) => Effect.Effect<void, FailedError>
}

const kind = (code: string): Kind => {
  if (code === "??") return "added"
  if (code.includes("U")) return "modified"
  if (code.includes("A") && !code.includes("D")) return "added"
  if (code.includes("D") && !code.includes("A")) return "deleted"
  return "modified"
}

const paths = (items: readonly string[]) => (items.length ? ["--", ...items] : ["--", "."])

const items = (text: string) =>
  nuls(text).flatMap((item) => {
    const file = item.slice(3)
    if (!file) return []
    const code = item.slice(0, 2)
    return [{ file, code, status: kind(code) } satisfies Item]
  })

const nameStatus = (text: string) => {
  const list = nuls(text)
  return list.flatMap((code, idx) => {
    if (idx % 2 !== 0) return []
    const file = list[idx + 1]
    if (!code || !file) return []
    return [{ file, code, status: kind(code) } satisfies Item]
  })
}

const numstat = (text: string) =>
  nuls(text).flatMap((item) => {
    const a = item.indexOf("\t")
    const b = item.indexOf("\t", a + 1)
    if (a === -1 || b === -1) return []
    const file = item.slice(b + 1)
    if (!file) return []
    const adds = item.slice(0, a)
    const dels = item.slice(a + 1, b)
    const additions = adds === "-" ? 0 : Number.parseInt(adds || "0", 10)
    const deletions = dels === "-" ? 0 : Number.parseInt(dels || "0", 10)
    return [
      {
        file,
        additions: Number.isFinite(additions) ? additions : 0,
        deletions: Number.isFinite(deletions) ? deletions : 0,
      } satisfies Stat,
    ]
  })

export class Service extends Context.Service<Service, Interface>()("@opencode/Git") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

    const run = Effect.fn("Git.run")(
      function* (args: string[], opts: Options) {
        const proc = ChildProcess.make("git", [...cfg, ...args], {
          cwd: opts.cwd,
          env: opts.env,
          extendEnv: true,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        })
        const handle = yield* spawner.spawn(proc)
        const [stdout, stderr] = yield* Effect.all(
          [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
          { concurrency: 2 },
        )
        return {
          exitCode: yield* handle.exitCode,
          text: () => stdout,
          stdout: Buffer.from(stdout),
          stderr: Buffer.from(stderr),
        } satisfies Result
      },
      Effect.scoped,
      Effect.catch((err) => Effect.succeed(fail(err))),
    )

    const ensure = Effect.fn("Git.ensure")(function* (result: Result) {
      if (result.exitCode === 0) return
      return yield* new FailedError({
        message: result.stderr.toString().trim() || result.text().trim() || `git exited with code ${result.exitCode}`,
      })
    })

    const text = Effect.fn("Git.text")(function* (args: string[], opts: Options) {
      return (yield* run(args, opts)).text()
    })

    const lines = Effect.fn("Git.lines")(function* (args: string[], opts: Options) {
      return (yield* text(args, opts))
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
    })

    const refs = Effect.fnUntraced(function* (cwd: string) {
      return yield* lines(["for-each-ref", "--format=%(refname:short)", "refs/heads"], { cwd })
    })

    const configured = Effect.fnUntraced(function* (cwd: string, list: string[]) {
      const result = yield* run(["config", "init.defaultBranch"], { cwd })
      const name = out(result)
      if (!name || !list.includes(name)) return
      return { name, ref: name } satisfies Base
    })

    const primary = Effect.fnUntraced(function* (cwd: string) {
      const list = yield* lines(["remote"], { cwd })
      if (list.includes("origin")) return "origin"
      if (list.length === 1) return list[0]
      if (list.includes("upstream")) return "upstream"
      return list[0]
    })

    const branch = Effect.fn("Git.branch")(function* (cwd: string) {
      const result = yield* run(["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd })
      if (result.exitCode !== 0) return
      const text = out(result)
      return text || undefined
    })

    const prefix = Effect.fn("Git.prefix")(function* (cwd: string) {
      const result = yield* run(["rev-parse", "--show-prefix"], { cwd })
      if (result.exitCode !== 0) return ""
      return out(result)
    })

    const defaultBranch = Effect.fn("Git.defaultBranch")(function* (cwd: string) {
      const remote = yield* primary(cwd)
      if (remote) {
        const head = yield* run(["symbolic-ref", `refs/remotes/${remote}/HEAD`], { cwd })
        if (head.exitCode === 0) {
          const ref = out(head).replace(/^refs\/remotes\//, "")
          const name = ref.startsWith(`${remote}/`) ? ref.slice(`${remote}/`.length) : ""
          if (name) return { name, ref } satisfies Base
        }
      }

      const list = yield* refs(cwd)
      const next = yield* configured(cwd, list)
      if (next) return next
      if (list.includes("main")) return { name: "main", ref: "main" } satisfies Base
      if (list.includes("master")) return { name: "master", ref: "master" } satisfies Base
    })

    const hasHead = Effect.fn("Git.hasHead")(function* (cwd: string) {
      const result = yield* run(["rev-parse", "--verify", "HEAD"], { cwd })
      return result.exitCode === 0
    })

    const tracking = Effect.fn("Git.tracking")(function* (cwd: string) {
      const upstream = yield* run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { cwd })
      if (upstream.exitCode !== 0) return { ahead: 0, behind: 0 } satisfies Tracking
      const name = out(upstream)
      if (!name) return { ahead: 0, behind: 0 } satisfies Tracking
      const counts = out(yield* run(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], { cwd })).split(/\s+/)
      return {
        upstream: name,
        behind: Number.parseInt(counts[0] || "0", 10) || 0,
        ahead: Number.parseInt(counts[1] || "0", 10) || 0,
      } satisfies Tracking
    })

    const mergeBase = Effect.fn("Git.mergeBase")(function* (cwd: string, base: string, head = "HEAD") {
      const result = yield* run(["merge-base", base, head], { cwd })
      if (result.exitCode !== 0) return
      const text = out(result)
      return text || undefined
    })

    const show = Effect.fn("Git.show")(function* (cwd: string, ref: string, file: string, prefix = "") {
      const target = prefix ? `${prefix}${file}` : file
      const result = yield* run(["show", `${ref}:${target}`], { cwd })
      if (result.exitCode !== 0) return ""
      if (result.stdout.includes(0)) return ""
      return result.text()
    })

    const showIndex = Effect.fn("Git.showIndex")(function* (cwd: string, file: string, prefix = "") {
      const target = prefix ? `${prefix}${file}` : file
      const result = yield* run(["show", `:${target}`], { cwd })
      if (result.exitCode !== 0) return ""
      if (result.stdout.includes(0)) return ""
      return result.text()
    })

    const status = Effect.fn("Git.status")(function* (cwd: string) {
      return items(
        yield* text(["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z", "--", "."], {
          cwd,
        }),
      )
    })

    const statusStaged = Effect.fn("Git.statusStaged")(function* (cwd: string) {
      return (yield* status(cwd)).flatMap((item) => {
        if (item.code[0] === " " || item.code[0] === "?") return []
        return [{ ...item, code: item.code[0] } satisfies Item]
      })
    })

    const statusUnstaged = Effect.fn("Git.statusUnstaged")(function* (cwd: string) {
      return (yield* status(cwd)).flatMap((item) => {
        if (item.code === "??") return [item]
        if (item.code[1] === " ") return []
        return [{ ...item, code: item.code[1] } satisfies Item]
      })
    })

    const diff = Effect.fn("Git.diff")(function* (cwd: string, ref: string) {
      return nameStatus(
        yield* text(["diff", "--no-ext-diff", "--no-renames", "--name-status", "-z", ref, "--", "."], { cwd }),
      )
    })

    const stats = Effect.fn("Git.stats")(function* (cwd: string, ref: string) {
      return numstat(
        yield* text(["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", ref, "--", "."], { cwd }),
      )
    })

    const statsCached = Effect.fn("Git.statsCached")(function* (cwd: string, ref = "HEAD") {
      return numstat(
        yield* text(["diff", "--cached", "--no-ext-diff", "--no-renames", "--numstat", "-z", ref, "--", "."], { cwd }),
      )
    })


    const statsUnstaged = Effect.fn("Git.statsUnstaged")(function* (cwd: string) {
      return numstat(yield* text(["diff", "--no-ext-diff", "--no-renames", "--numstat", "-z", "--", "."], { cwd }))
    })

    const add = Effect.fn("Git.add")(function* (cwd: string, items: readonly string[]) {
      yield* ensure(yield* run(["add", ...paths(items)], { cwd }))
    })

    const unstage = Effect.fn("Git.unstage")(function* (cwd: string, items: readonly string[]) {
      yield* ensure(yield* run(["restore", "--staged", ...paths(items)], { cwd }))
    })

    const revertUnstaged = Effect.fn("Git.revertUnstaged")(function* (cwd: string, targets: readonly string[]) {
      const changed = items(
        yield* text(["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z", ...paths(targets)], {
          cwd,
        }),
      )
      const tracked = changed.filter((item) => item.code !== "??" && item.code[1] !== " ").map((item) => item.file)
      const untracked = changed.filter((item) => item.code === "??").map((item) => item.file)
      if (tracked.length > 0) yield* ensure(yield* run(["restore", "--worktree", "--", ...tracked], { cwd }))
      if (untracked.length > 0) yield* ensure(yield* run(["clean", "-fd", ...(targets.length ? ["--", ...untracked] : paths(targets))], { cwd }))
    })

    const commit = Effect.fn("Git.commit")(function* (cwd: string, message: string) {
      yield* ensure(yield* run(["commit", "-m", message], { cwd }))
    })

    const push = Effect.fn("Git.push")(function* (cwd: string) {
      yield* ensure(yield* run(["push"], { cwd }))
    })

    const pull = Effect.fn("Git.pull")(function* (cwd: string) {
      yield* ensure(yield* run(["pull", "--ff-only"], { cwd }))
    })

    return Service.of({
      run,
      branch,
      prefix,
      defaultBranch,
      hasHead,
      tracking,
      mergeBase,
      show,
      showIndex,
      status,
      statusStaged,
      statusUnstaged,
      diff,
      stats,
      statsCached,
      statsUnstaged,
      add,
      unstage,
      revertUnstaged,
      commit,
      push,
      pull,
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(CrossSpawnSpawner.defaultLayer))

export * as Git from "."
