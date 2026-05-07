import { Agent } from "@/agent/agent"
import { Command } from "@/command"
import { Format } from "@/format"
import { Global } from "@opencode-ai/core/global"
import { LSP } from "@/lsp"
import { Vcs } from "@/project"
import { Skill } from "@/skill"
import * as InstanceState from "@/effect/instance-state"
import { Effect, Layer, Schema } from "effect"
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiError, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "./auth"
import { markInstanceForDisposal } from "./lifecycle"

const PathInfo = Schema.Struct({
  home: Schema.String,
  state: Schema.String,
  config: Schema.String,
  worktree: Schema.String,
  directory: Schema.String,
}).annotate({ identifier: "Path" })

const VcsDiffQuery = Schema.Struct({
  mode: Vcs.Mode,
})

export const InstancePaths = {
  dispose: "/instance/dispose",
  path: "/path",
  vcs: "/vcs",
  vcsDiff: "/vcs/diff",
  vcsChanges: "/vcs/changes",
  vcsCommitMessage: "/vcs/commit-message",
  vcsStage: "/vcs/stage",
  vcsUnstage: "/vcs/unstage",
  vcsRevert: "/vcs/revert",
  vcsCommit: "/vcs/commit",
  vcsPush: "/vcs/push",
  vcsPull: "/vcs/pull",
  command: "/command",
  agent: "/agent",
  skill: "/skill",
  lsp: "/lsp",
  formatter: "/formatter",
} as const

export const InstanceApi = HttpApi.make("instance")
  .add(
    HttpApiGroup.make("instance")
      .add(
        HttpApiEndpoint.post("dispose", InstancePaths.dispose, {
          success: Schema.Boolean,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "instance.dispose",
            summary: "Dispose instance",
            description: "Clean up and dispose the current OpenCode instance, releasing all resources.",
          }),
        ),
        HttpApiEndpoint.get("path", InstancePaths.path, {
          success: PathInfo,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "path.get",
            summary: "Get paths",
            description:
              "Retrieve the current working directory and related path information for the OpenCode instance.",
          }),
        ),
        HttpApiEndpoint.get("vcs", InstancePaths.vcs, {
          success: Vcs.Info,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "vcs.get",
            summary: "Get VCS info",
            description:
              "Retrieve version control system (VCS) information for the current project, such as git branch.",
          }),
        ),
        HttpApiEndpoint.get("vcsDiff", InstancePaths.vcsDiff, {
          query: VcsDiffQuery,
          success: Schema.Array(Vcs.FileDiff),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "vcs.diff",
            summary: "Get VCS diff",
            description: "Retrieve the current git diff for the working tree or against the default branch.",
          }),
        ),
        HttpApiEndpoint.get("vcsChanges", InstancePaths.vcsChanges, {
          success: Vcs.ChangeSet,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "vcs.changes",
            summary: "Get VCS changes",
            description: "Retrieve staged and unstaged git changes for the working tree.",
          }),
        ),
        HttpApiEndpoint.post("vcsCommitMessage", InstancePaths.vcsCommitMessage, {
          success: Vcs.CommitMessageResponse,
          error: Vcs.NoStagedChangesError,
        }).annotateMerge(
          OpenApi.annotations({ identifier: "vcs.commitMessage", summary: "Generate VCS commit message" }),
        ),
        HttpApiEndpoint.post("vcsStage", InstancePaths.vcsStage, {
          payload: Vcs.PathsRequest,
          success: Vcs.ChangeSet,
        }).annotateMerge(OpenApi.annotations({ identifier: "vcs.stage", summary: "Stage VCS paths" })),
        HttpApiEndpoint.post("vcsUnstage", InstancePaths.vcsUnstage, {
          payload: Vcs.PathsRequest,
          success: Vcs.ChangeSet,
        }).annotateMerge(OpenApi.annotations({ identifier: "vcs.unstage", summary: "Unstage VCS paths" })),
        HttpApiEndpoint.post("vcsRevert", InstancePaths.vcsRevert, {
          payload: Vcs.PathsRequest,
          success: Vcs.ChangeSet,
        }).annotateMerge(OpenApi.annotations({ identifier: "vcs.revert", summary: "Revert unstaged VCS paths" })),
        HttpApiEndpoint.post("vcsCommit", InstancePaths.vcsCommit, {
          payload: Vcs.CommitRequest,
          success: Vcs.ChangeSet,
        }).annotateMerge(OpenApi.annotations({ identifier: "vcs.commit", summary: "Commit staged VCS changes" })),
        HttpApiEndpoint.post("vcsPush", InstancePaths.vcsPush, {
          success: Vcs.ChangeSet,
        }).annotateMerge(OpenApi.annotations({ identifier: "vcs.push", summary: "Push VCS branch" })),
        HttpApiEndpoint.post("vcsPull", InstancePaths.vcsPull, {
          success: Vcs.ChangeSet,
        }).annotateMerge(OpenApi.annotations({ identifier: "vcs.pull", summary: "Pull VCS branch" })),
        HttpApiEndpoint.get("command", InstancePaths.command, {
          success: Schema.Array(Command.Info),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "command.list",
            summary: "List commands",
            description: "Get a list of all available commands in the OpenCode system.",
          }),
        ),
        HttpApiEndpoint.get("agent", InstancePaths.agent, {
          success: Schema.Array(Agent.Info),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "app.agents",
            summary: "List agents",
            description: "Get a list of all available AI agents in the OpenCode system.",
          }),
        ),
        HttpApiEndpoint.get("skill", InstancePaths.skill, {
          success: Schema.Array(Skill.Info),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "app.skills",
            summary: "List skills",
            description: "Get a list of all available skills in the OpenCode system.",
          }),
        ),
        HttpApiEndpoint.get("lsp", InstancePaths.lsp, {
          success: Schema.Array(LSP.Status),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "lsp.status",
            summary: "Get LSP status",
            description: "Get LSP server status",
          }),
        ),
        HttpApiEndpoint.get("formatter", InstancePaths.formatter, {
          success: Schema.Array(Format.Status),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "formatter.status",
            summary: "Get formatter status",
            description: "Get formatter status",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "instance",
          description: "Experimental HttpApi instance read routes.",
        }),
      )
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "opencode experimental HttpApi",
      version: "0.0.1",
      description: "Experimental HttpApi surface for selected instance routes.",
    }),
  )

export const instanceHandlers = Layer.unwrap(
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const command = yield* Command.Service
    const format = yield* Format.Service
    const lsp = yield* LSP.Service
    const skill = yield* Skill.Service
    const vcs = yield* Vcs.Service

    const dispose = Effect.fn("InstanceHttpApi.dispose")(function* () {
      yield* markInstanceForDisposal(yield* InstanceState.context)
      return true
    })

    const getPath = Effect.fn("InstanceHttpApi.path")(function* () {
      const ctx = yield* InstanceState.context
      return {
        home: Global.Path.home,
        state: Global.Path.state,
        config: Global.Path.config,
        worktree: ctx.worktree,
        directory: ctx.directory,
      }
    })

    const getVcs = Effect.fn("InstanceHttpApi.vcs")(function* () {
      const [branch, default_branch] = yield* Effect.all([vcs.branch(), vcs.defaultBranch()], { concurrency: 2 })
      return { branch, default_branch }
    })

    const getVcsDiff = Effect.fn("InstanceHttpApi.vcsDiff")(function* (ctx: { query: { mode: Vcs.Mode } }) {
      return yield* vcs.diff(ctx.query.mode)
    })

    const getVcsChanges = Effect.fn("InstanceHttpApi.vcsChanges")(function* () {
      return yield* vcs.changes()
    })

    const badRequest = (error: unknown) => {
      const result = new HttpApiError.BadRequest({})
      if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
        Object.defineProperty(result, "message", { value: error.message })
      }
      return result
    }

    const stageVcs = Effect.fn("InstanceHttpApi.vcsStage")(function* (ctx: { payload: Vcs.PathsRequest }) {
      return yield* vcs.stage(ctx.payload.paths ?? []).pipe(Effect.mapError(badRequest))
    })

    const commitMessageVcs = Effect.fn("InstanceHttpApi.vcsCommitMessage")(function* () {
      return yield* vcs.commitMessage()
    })

    const unstageVcs = Effect.fn("InstanceHttpApi.vcsUnstage")(function* (ctx: { payload: Vcs.PathsRequest }) {
      return yield* vcs.unstage(ctx.payload.paths ?? []).pipe(Effect.mapError(badRequest))
    })

    const revertVcs = Effect.fn("InstanceHttpApi.vcsRevert")(function* (ctx: { payload: Vcs.PathsRequest }) {
      return yield* vcs.revertUnstaged(ctx.payload.paths ?? []).pipe(Effect.mapError(badRequest))
    })

    const commitVcs = Effect.fn("InstanceHttpApi.vcsCommit")(function* (ctx: { payload: Vcs.CommitRequest }) {
      return yield* vcs.commit(ctx.payload.message).pipe(Effect.mapError(badRequest))
    })

    const pushVcs = Effect.fn("InstanceHttpApi.vcsPush")(function* () {
      return yield* vcs.push().pipe(Effect.mapError(badRequest))
    })

    const pullVcs = Effect.fn("InstanceHttpApi.vcsPull")(function* () {
      return yield* vcs.pull().pipe(Effect.mapError(badRequest))
    })

    const getCommand = Effect.fn("InstanceHttpApi.command")(function* () {
      return yield* command.list()
    })

    const getAgent = Effect.fn("InstanceHttpApi.agent")(function* () {
      return yield* agent.list()
    })

    const getSkill = Effect.fn("InstanceHttpApi.skill")(function* () {
      return yield* skill.all()
    })

    const getLsp = Effect.fn("InstanceHttpApi.lsp")(function* () {
      return yield* lsp.status()
    })

    const getFormatter = Effect.fn("InstanceHttpApi.formatter")(function* () {
      return yield* format.status()
    })

    return HttpApiBuilder.group(InstanceApi, "instance", (handlers) =>
      handlers
        .handle("dispose", dispose)
        .handle("path", getPath)
        .handle("vcs", getVcs)
        .handle("vcsDiff", getVcsDiff)
        .handle("vcsChanges", getVcsChanges)
        .handle("vcsCommitMessage", commitMessageVcs)
        .handle("vcsStage", stageVcs)
        .handle("vcsUnstage", unstageVcs)
        .handle("vcsRevert", revertVcs)
        .handle("vcsCommit", commitVcs)
        .handle("vcsPush", pushVcs)
        .handle("vcsPull", pullVcs)
        .handle("command", getCommand)
        .handle("agent", getAgent)
        .handle("skill", getSkill)
        .handle("lsp", getLsp)
        .handle("formatter", getFormatter),
    )
  }),
).pipe(
  Layer.provide(Agent.defaultLayer),
  Layer.provide(Command.defaultLayer),
  Layer.provide(Format.defaultLayer),
  Layer.provide(LSP.defaultLayer),
  Layer.provide(Skill.defaultLayer),
  Layer.provide(Vcs.defaultLayer),
)
