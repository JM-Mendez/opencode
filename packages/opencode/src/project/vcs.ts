import { Effect, Layer, Context, Schema, Stream, Scope } from "effect"
import { formatPatch, structuredPatch } from "diff"
import path from "path"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { FileWatcher } from "@/file/watcher"
import { Git } from "@/git"
import { Log } from "@/util"
import { zod } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider"
import { LLM } from "@/session/llm"
import { MessageID, SessionID } from "@/session/schema"

const log = Log.create({ service: "vcs" })

const count = (text: string) => {
  if (!text) return 0
  if (!text.endsWith("\n")) return text.split("\n").length
  return text.slice(0, -1).split("\n").length
}

const work = Effect.fnUntraced(function* (fs: AppFileSystem.Interface, cwd: string, file: string) {
  const full = path.join(cwd, file)
  if (!(yield* fs.exists(full).pipe(Effect.orDie))) return ""
  const buf = yield* fs.readFile(full).pipe(Effect.catch(() => Effect.succeed(new Uint8Array())))
  if (Buffer.from(buf).includes(0)) return ""
  return Buffer.from(buf).toString("utf8")
})

const nums = (list: Git.Stat[]) =>
  new Map(list.map((item) => [item.file, { additions: item.additions, deletions: item.deletions }] as const))

const merge = (...lists: Git.Item[][]) => {
  const out = new Map<string, Git.Item>()
  lists.flat().forEach((item) => {
    if (!out.has(item.file)) out.set(item.file, item)
  })
  return [...out.values()]
}

const files = Effect.fnUntraced(function* (
  fs: AppFileSystem.Interface,
  git: Git.Interface,
  cwd: string,
  ref: string | undefined,
  list: Git.Item[],
  map: Map<string, { additions: number; deletions: number }>,
) {
  const base = ref ? yield* git.prefix(cwd) : ""
  const patch = (file: string, before: string, after: string) =>
    formatPatch(structuredPatch(file, file, before, after, "", "", { context: Number.MAX_SAFE_INTEGER }))
  const next = yield* Effect.forEach(
    list,
    (item) =>
      Effect.gen(function* () {
        const before = item.status === "added" || !ref ? "" : yield* git.show(cwd, ref, item.file, base)
        const after = item.status === "deleted" ? "" : yield* work(fs, cwd, item.file)
        const stat = map.get(item.file)
        return {
          file: item.file,
          patch: patch(item.file, before, after),
          additions: stat?.additions ?? (item.status === "added" ? count(after) : 0),
          deletions: stat?.deletions ?? (item.status === "deleted" ? count(before) : 0),
          status: item.status,
        } satisfies FileDiff
      }),
    { concurrency: 8 },
  )
  return next.toSorted((a, b) => a.file.localeCompare(b.file))
})

const stagedFiles = Effect.fnUntraced(function* (
  git: Git.Interface,
  cwd: string,
  list: Git.Item[],
  map: Map<string, { additions: number; deletions: number }>,
) {
  const base = yield* git.prefix(cwd)
  const hasHead = yield* git.hasHead(cwd)
  const patch = (file: string, before: string, after: string) =>
    formatPatch(structuredPatch(file, file, before, after, "", "", { context: Number.MAX_SAFE_INTEGER }))
  const next = yield* Effect.forEach(
    list,
    (item) =>
      Effect.gen(function* () {
        const before = item.status === "added" || !hasHead ? "" : yield* git.show(cwd, "HEAD", item.file, base)
        const after = item.status === "deleted" ? "" : yield* git.showIndex(cwd, item.file, base)
        const stat = map.get(item.file)
        return {
          file: item.file,
          patch: patch(item.file, before, after),
          additions: stat?.additions ?? (item.status === "added" ? count(after) : 0),
          deletions: stat?.deletions ?? (item.status === "deleted" ? count(before) : 0),
          status: item.status,
        } satisfies FileDiff
      }),
    { concurrency: 8 },
  )
  return next.toSorted((a, b) => a.file.localeCompare(b.file))
})

const unstagedFiles = Effect.fnUntraced(function* (
  fs: AppFileSystem.Interface,
  git: Git.Interface,
  cwd: string,
  list: Git.Item[],
  map: Map<string, { additions: number; deletions: number }>,
) {
  const base = yield* git.prefix(cwd)
  const patch = (file: string, before: string, after: string) =>
    formatPatch(structuredPatch(file, file, before, after, "", "", { context: Number.MAX_SAFE_INTEGER }))
  const next = yield* Effect.forEach(
    list,
    (item) =>
      Effect.gen(function* () {
        const before = item.status === "added" ? "" : yield* git.showIndex(cwd, item.file, base)
        const after = item.status === "deleted" ? "" : yield* work(fs, cwd, item.file)
        const stat = map.get(item.file)
        return {
          file: item.file,
          patch: patch(item.file, before, after),
          additions: stat?.additions ?? (item.status === "added" ? count(after) : 0),
          deletions: stat?.deletions ?? (item.status === "deleted" ? count(before) : 0),
          status: item.status,
        } satisfies FileDiff
      }),
    { concurrency: 8 },
  )
  return next.toSorted((a, b) => a.file.localeCompare(b.file))
})

const track = Effect.fnUntraced(function* (
  fs: AppFileSystem.Interface,
  git: Git.Interface,
  cwd: string,
  ref: string | undefined,
) {
  if (!ref) return yield* files(fs, git, cwd, ref, yield* git.status(cwd), new Map())
  const [list, stats] = yield* Effect.all([git.status(cwd), git.stats(cwd, ref)], { concurrency: 2 })
  return yield* files(fs, git, cwd, ref, list, nums(stats))
})

const compare = Effect.fnUntraced(function* (
  fs: AppFileSystem.Interface,
  git: Git.Interface,
  cwd: string,
  ref: string,
) {
  const [list, stats, extra] = yield* Effect.all([git.diff(cwd, ref), git.stats(cwd, ref), git.status(cwd)], {
    concurrency: 3,
  })
  return yield* files(
    fs,
    git,
    cwd,
    ref,
    merge(
      list,
      extra.filter((item) => item.code === "??"),
    ),
    nums(stats),
  )
})

export const Mode = Schema.Literals(["git", "branch"]).pipe(withStatics((s) => ({ zod: zod(s) })))
export type Mode = Schema.Schema.Type<typeof Mode>

export const Event = {
  BranchUpdated: BusEvent.define(
    "vcs.branch.updated",
    Schema.Struct({
      branch: Schema.optional(Schema.String),
    }),
  ),
}

export const Info = Schema.Struct({
  branch: Schema.optional(Schema.String),
  default_branch: Schema.optional(Schema.String),
})
  .annotate({ identifier: "VcsInfo" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Info = Schema.Schema.Type<typeof Info>

export const FileDiff = Schema.Struct({
  file: Schema.String,
  patch: Schema.String,
  additions: Schema.Number,
  deletions: Schema.Number,
  status: Schema.optional(Schema.Literals(["added", "deleted", "modified"])),
})
  .annotate({ identifier: "VcsFileDiff" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type FileDiff = Schema.Schema.Type<typeof FileDiff>

export const ChangeSet = Schema.Struct({
  branch: Schema.optional(Schema.String),
  default_branch: Schema.optional(Schema.String),
  upstream: Schema.optional(Schema.String),
  ahead: Schema.Number,
  behind: Schema.Number,
  staged: Schema.Array(FileDiff),
  unstaged: Schema.Array(FileDiff),
})
  .annotate({ identifier: "VcsChangeSet" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type ChangeSet = Schema.Schema.Type<typeof ChangeSet>

export const PathsRequest = Schema.Struct({
  paths: Schema.optional(Schema.Array(Schema.String)),
})
  .annotate({ identifier: "VcsPathsRequest" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type PathsRequest = Schema.Schema.Type<typeof PathsRequest>

export const CommitRequest = Schema.Struct({
  message: Schema.String,
})
  .annotate({ identifier: "VcsCommitRequest" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type CommitRequest = Schema.Schema.Type<typeof CommitRequest>

export const CommitMessageResponse = Schema.Struct({
  message: Schema.String,
})
  .annotate({ identifier: "VcsCommitMessageResponse" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type CommitMessageResponse = Schema.Schema.Type<typeof CommitMessageResponse>

export class NoStagedChangesError extends Schema.TaggedErrorClass<NoStagedChangesError>()(
  "NoStagedChangesError",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly branch: () => Effect.Effect<string | undefined>
  readonly defaultBranch: () => Effect.Effect<string | undefined>
  readonly diff: (mode: Mode) => Effect.Effect<FileDiff[]>
  readonly changes: () => Effect.Effect<ChangeSet>
  readonly stage: (paths: readonly string[]) => Effect.Effect<ChangeSet, Git.FailedError>
  readonly unstage: (paths: readonly string[]) => Effect.Effect<ChangeSet, Git.FailedError>
  readonly revertUnstaged: (paths: readonly string[]) => Effect.Effect<ChangeSet, Git.FailedError>
  readonly commitMessage: () => Effect.Effect<CommitMessageResponse, NoStagedChangesError>
  readonly commit: (message: string) => Effect.Effect<ChangeSet, Git.FailedError>
  readonly push: () => Effect.Effect<ChangeSet, Git.FailedError>
  readonly pull: () => Effect.Effect<ChangeSet, Git.FailedError>
}

interface State {
  current: string | undefined
  root: Git.Base | undefined
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Vcs") {}

export const layer: Layer.Layer<
  Service,
  never,
  AppFileSystem.Service | Git.Service | Bus.Service | Agent.Service | Provider.Service | LLM.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const git = yield* Git.Service
    const bus = yield* Bus.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const scope = yield* Scope.Scope

    const state = yield* InstanceState.make<State>(
      Effect.fn("Vcs.state")(function* (ctx) {
        if (ctx.project.vcs !== "git") {
          return { current: undefined, root: undefined }
        }

        const get = Effect.fnUntraced(function* () {
          return yield* git.branch(ctx.directory)
        })
        const [current, root] = yield* Effect.all([git.branch(ctx.directory), git.defaultBranch(ctx.directory)], {
          concurrency: 2,
        })
        const value = { current, root }
        log.info("initialized", { branch: value.current, default_branch: value.root?.name })

        yield* bus.subscribe(FileWatcher.Event.Updated).pipe(
          Stream.filter((evt) => evt.properties.file.endsWith("HEAD")),
          Stream.runForEach((_evt) =>
            Effect.gen(function* () {
              const next = yield* get()
              if (next !== value.current) {
                log.info("branch changed", { from: value.current, to: next })
                value.current = next
                yield* bus.publish(Event.BranchUpdated, { branch: next })
              }
            }),
          ),
          Effect.forkScoped,
        )

        return value
      }),
    )

    const changes = Effect.fn("Vcs.changes")(function* () {
      const ctx = yield* InstanceState.context
      if (ctx.project.vcs !== "git") return { ahead: 0, behind: 0, staged: [], unstaged: [] }
      const value = yield* InstanceState.get(state)
      const hasHead = yield* git.hasHead(ctx.directory)
      const [staged, unstaged, stagedStats, unstagedStats, tracking] = yield* Effect.all(
        [
          git.statusStaged(ctx.directory),
          git.statusUnstaged(ctx.directory),
          hasHead ? git.statsCached(ctx.directory) : git.statsCached(ctx.directory, "--root"),
          git.statsUnstaged(ctx.directory),
          git.tracking(ctx.directory),
        ],
        { concurrency: 5 },
      )
      return {
        branch: value.current,
        default_branch: value.root?.name,
        upstream: tracking.upstream,
        ahead: tracking.ahead,
        behind: tracking.behind,
        staged: yield* stagedFiles(git, ctx.directory, staged, nums(stagedStats)),
        unstaged: yield* unstagedFiles(fs, git, ctx.directory, unstaged, nums(unstagedStats)),
      }
    })

    return Service.of({
      init: Effect.fn("Vcs.init")(function* () {
        yield* InstanceState.get(state).pipe(Effect.forkIn(scope))
      }),
      branch: Effect.fn("Vcs.branch")(function* () {
        return yield* InstanceState.use(state, (x) => x.current)
      }),
      defaultBranch: Effect.fn("Vcs.defaultBranch")(function* () {
        return yield* InstanceState.use(state, (x) => x.root?.name)
      }),
      diff: Effect.fn("Vcs.diff")(function* (mode: Mode) {
        const value = yield* InstanceState.get(state)
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs !== "git") return []
        if (mode === "git") {
          return yield* track(fs, git, ctx.directory, (yield* git.hasHead(ctx.directory)) ? "HEAD" : undefined)
        }

        if (!value.root) return []
        if (value.current && value.current === value.root.name) return []
        const ref = yield* git.mergeBase(ctx.directory, value.root.ref)
        if (!ref) return []
        return yield* compare(fs, git, ctx.directory, ref)
      }),
      changes,
      commitMessage: Effect.fn("Vcs.commitMessage")(function* () {
        const diff = yield* changes()
        if (diff.staged.length === 0) {
          return yield* new NoStagedChangesError({ message: "No staged changes available for commit message generation" })
        }

        const model = yield* provider.defaultModel().pipe(Effect.flatMap((x) => provider.getModel(x.providerID, x.modelID)))
        const text = yield* llm
          .stream({
            agent: {
              name: "commit",
              mode: "primary",
              options: {},
              permission: [],
            },
            user: {
              id: MessageID.ascending(),
              sessionID: SessionID.descending(),
              role: "user",
              time: { created: Date.now() },
              agent: "commit",
              model: { providerID: model.providerID, modelID: model.id },
            },
            system: [
              "You write git commit messages. Your output is used directly as the commit message.",
              "",
              "STRICT FORMAT — you MUST follow this exactly:",
              "<type>: <short description in imperative mood, no period, max 72 chars total>",
              "",
              "<blank line>",
              "<detailed body explaining what changed, why, and how. This is REQUIRED, not optional.>",
              "",
              "<detailed body continued. Use multiple paragraphs if needed.>",
              "",
              "Rules:",
              "- Type MUST be one of: feat, fix, docs, style, refactor, test, chore, perf, ci, build",
              "- Scope is NOT allowed. Never use parentheses after the type.",
              "- Title line: max 72 characters including the type prefix",
              "- Title line: imperative mood (e.g., 'add' not 'added' or 'adds')",
              "- Title line: NO period at the end",
              "- There MUST be a blank line between the title and the body",
              "- The body is MANDATORY. It must be at least 2-3 sentences.",
              "- Body: explain the motivation for the change and contrast with previous behavior",
              "- Body: describe what each modified file does in the context of the change",
              "- Body: use natural paragraphs, NOT bullet points",
              "- NEVER output only a title. A body is always required.",
              "- NEVER write generic text like 'Commit message for...' or 'Changes to...'",
              "- NEVER describe the diff format itself (e.g., 'modified file X')",
              "- NEVER wrap the output in markdown code blocks",
              "- Return ONLY the raw commit message text",
              "",
              "EXAMPLE — this is the quality you must achieve:",
              "feat: add email validation to user registration form",
              "",
              "Add server-side email validation using the validator.js library to prevent",
              "malformed email addresses from reaching the database. Previously, invalid",
              "emails were silently accepted, causing downstream delivery failures.",
              "",
              "The validation runs before the password hash step and returns a 422",
              "response with a clear error message when the email format is invalid.",
            ],
            small: true,
            tools: {},
            model: (yield* provider.getSmallModel(model.providerID)) ?? model,
            sessionID: SessionID.descending(),
            retries: 2,
            messages: [
              {
                role: "user",
                content:
                  "Write a commit message for the staged changes below.\n\n" +
                  "REMEMBER:\n" +
                  "- You MUST include a detailed body after a blank line.\n" +
                  "- The body must explain what changed and why.\n" +
                  "- Do NOT write generic text like 'Commit message for session mobile changes'.\n" +
                  "- Do NOT describe the diff format. Describe the actual code changes.\n\n" +
                  diff.staged
                    .map((file) => `File: ${file.file}\nStatus: ${file.status ?? "modified"}\n${file.patch}`)
                    .join("\n\n")
                    .slice(0, 24_000),
              },
            ],
          })
          .pipe(
            Stream.filter((e): e is Extract<LLM.Event, { type: "text-delta" }> => e.type === "text-delta"),
            Stream.map((e) => e.text),
            Stream.mkString,
            Effect.orDie,
          )
        const message = text
          .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
          .replace(/^```[\s\S]*?\n|```$/g, "")
          .trim()
          .replace(/^['\"]|['\"]$/g, "")
          .trim()
        if (!message) throw new Error("Commit message generation returned an empty message")
        return { message }
      }),
      stage: Effect.fn("Vcs.stage")(function* (paths: readonly string[]) {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs === "git") yield* git.add(ctx.directory, paths)
        return yield* changes()
      }),
      unstage: Effect.fn("Vcs.unstage")(function* (paths: readonly string[]) {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs === "git") yield* git.unstage(ctx.directory, paths)
        return yield* changes()
      }),
      revertUnstaged: Effect.fn("Vcs.revertUnstaged")(function* (paths: readonly string[]) {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs === "git") yield* git.revertUnstaged(ctx.directory, paths)
        return yield* changes()
      }),
      commit: Effect.fn("Vcs.commit")(function* (message: string) {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs === "git") yield* git.commit(ctx.directory, message)
        return yield* changes()
      }),
      push: Effect.fn("Vcs.push")(function* () {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs === "git") {
          const [topLevel, primary] = yield* Effect.all([git.topLevel(ctx.directory), git.primaryWorktree(ctx.directory)], {
            concurrency: 2,
          })
          if (!topLevel || !primary || topLevel === primary) {
            yield* git.push(ctx.directory)
            return yield* changes()
          }

          const [workspaceBranch, primaryBranch, primaryStaged, primaryUnstaged] = yield* Effect.all(
            [git.branch(ctx.directory), git.branch(primary), git.statusStaged(primary), git.statusUnstaged(primary)],
            { concurrency: 4 },
          )
          if (!workspaceBranch) return yield* new Git.FailedError({ message: "Cannot push linked worktree without a branch" })
          if (!primaryBranch) return yield* new Git.FailedError({ message: "Cannot push primary worktree without a branch" })
          const parentBranch = (yield* git.createdFrom(ctx.directory, workspaceBranch)) ?? primaryBranch
          if (primaryStaged.length > 0 || primaryUnstaged.length > 0) {
            return yield* new Git.FailedError({
              message: "Cannot sync linked worktree while primary worktree has uncommitted changes",
            })
          }
          if (primaryBranch !== parentBranch) yield* git.checkout(primary, parentBranch)
          yield* git.pull(primary)
          yield* git.merge(primary, workspaceBranch)
          yield* git.push(primary)
        }
        return yield* changes()
      }),
      pull: Effect.fn("Vcs.pull")(function* () {
        const ctx = yield* InstanceState.context
        if (ctx.project.vcs === "git") yield* git.pull(ctx.directory)
        return yield* changes()
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(LLM.defaultLayer),
  Layer.provide(Provider.defaultLayer),
  Layer.provide(Agent.defaultLayer),
  Layer.provide(Git.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Bus.layer),
)
