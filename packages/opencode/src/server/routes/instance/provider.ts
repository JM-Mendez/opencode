import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Config } from "@/config"
import { Provider } from "@/provider"
import { ModelsDev } from "@/provider"
import { ProviderAuth } from "@/provider"
import { ProviderID } from "@/provider/schema"
import { Auth } from "@/auth"
import { extractAccountId, refreshAccessToken } from "@/plugin/codex"
import { mapValues } from "remeda"
import { errors } from "../../error"
import { lazy } from "@/util/lazy"
import { Effect } from "effect"
import { jsonRequest } from "./trace"

const ChatGPTUsageWindow = z
  .object({
    usedPercent: z.number().nullable(),
    remainingPercent: z.number().nullable(),
    resetsAt: z.number().nullable(),
    resetAfterSeconds: z.number().nullable(),
  })
  .nullable()

const ChatGPTUsage = z.object({
  available: z.boolean(),
  plan: z.string().nullable(),
  allowed: z.boolean().nullable(),
  limited: z.boolean().nullable(),
  primary: ChatGPTUsageWindow,
  secondary: ChatGPTUsageWindow,
  reason: z.enum(["missing_auth", "unsupported_auth", "upstream_error"]).nullable(),
})

const WhamWindow = z.object({
  used_percent: z.number().optional(),
  reset_at: z.number().optional(),
  reset_after_seconds: z.number().optional(),
})

const WhamUsage = z.object({
  plan_type: z.string().optional(),
  rate_limit: z
    .object({
      allowed: z.boolean().optional(),
      limit_reached: z.boolean().optional(),
      primary_window: WhamWindow.optional(),
      secondary_window: WhamWindow.optional(),
    })
    .optional(),
})

function normalizeWindow(window: z.infer<typeof WhamWindow> | undefined) {
  if (!window) return null
  const usedPercent = typeof window.used_percent === "number" ? Math.max(0, Math.min(100, window.used_percent)) : null
  return {
    usedPercent,
    remainingPercent: usedPercent === null ? null : Math.max(0, 100 - usedPercent),
    resetsAt: window.reset_at ?? null,
    resetAfterSeconds: window.reset_after_seconds ?? null,
  }
}

function unavailable(reason: z.infer<typeof ChatGPTUsage>["reason"]): z.infer<typeof ChatGPTUsage> {
  return {
    available: false,
    plan: null,
    allowed: null,
    limited: null,
    primary: null,
    secondary: null,
    reason,
  }
}

export const ProviderRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List providers",
        description: "Get a list of all available AI providers, including both available and connected ones.",
        operationId: "provider.list",
        responses: {
          200: {
            description: "List of providers",
            content: {
              "application/json": {
                schema: resolver(Provider.ListResult.zod),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ProviderRoutes.list", c, function* () {
          const svc = yield* Provider.Service
          const cfg = yield* Config.Service
          const config = yield* cfg.get()
          const all = yield* Effect.promise(() => ModelsDev.get())
          const disabled = new Set(config.disabled_providers ?? [])
          const enabled = config.enabled_providers ? new Set(config.enabled_providers) : undefined
          const filtered: Record<string, (typeof all)[string]> = {}
          for (const [key, value] of Object.entries(all)) {
            if ((enabled ? enabled.has(key) : true) && !disabled.has(key)) {
              filtered[key] = value
            }
          }
          const connected = yield* svc.list()
          const providers = Object.assign(
            mapValues(filtered, (x) => Provider.fromModelsDevProvider(x)),
            connected,
          )
          return {
            all: Object.values(providers),
            default: Provider.defaultModelIDs(providers),
            connected: Object.keys(connected),
          }
        }),
    )
    .get(
      "/auth",
      describeRoute({
        summary: "Get provider auth methods",
        description: "Retrieve available authentication methods for all AI providers.",
        operationId: "provider.auth",
        responses: {
          200: {
            description: "Provider auth methods",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Methods.zod),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ProviderRoutes.auth", c, function* () {
          const svc = yield* ProviderAuth.Service
          return yield* svc.methods()
        }),
    )
    .get(
      "/chatgpt/usage",
      describeRoute({
        summary: "Get ChatGPT usage",
        description: "Get normalized ChatGPT plan and rate limit usage from locally stored OAuth credentials.",
        operationId: "provider.chatgpt.usage",
        responses: {
          200: {
            description: "ChatGPT usage",
            content: {
              "application/json": {
                schema: resolver(ChatGPTUsage),
              },
            },
          },
        },
      }),
      async (c) =>
        jsonRequest("ProviderRoutes.chatgptUsage", c, function* () {
          const auth = yield* Auth.Service
          const entries = yield* Effect.forEach(["openai", "codex", "chatgpt"], (key) =>
            Effect.gen(function* () {
              return { key, info: yield* auth.get(key) }
            }),
          )
          const entry = entries.find((entry) => entry.info?.type === "oauth")
          if (!entry && !entries.some((entry) => !!entry.info)) return unavailable("missing_auth")
          if (!entry) return unavailable("unsupported_auth")
          const info = entry.info
          if (info?.type !== "oauth") return unavailable("unsupported_auth")

          const current = info.expires < Date.now() + 30_000
            ? yield* Effect.promise(async () => {
                const tokens = await refreshAccessToken(info.refresh)
                const accountId = extractAccountId(tokens) || info.accountId
                return {
                  type: "oauth" as const,
                  refresh: tokens.refresh_token,
                  access: tokens.access_token,
                  expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
                  ...(accountId && { accountId }),
                }
              }).pipe(Effect.catch(() => Effect.succeed(undefined)))
            : info
          if (!current) return unavailable("upstream_error")
          if (current !== info) yield* auth.set(entry.key, current)

          return yield* Effect.promise(async () => {
            const headers = new Headers({ authorization: `Bearer ${current.access}` })
            if (current.accountId) headers.set("ChatGPT-Account-Id", current.accountId)
            const response = await fetch("https://chatgpt.com/backend-api/wham/usage", { headers })
            if (!response.ok) return unavailable("upstream_error")
            const parsed = WhamUsage.safeParse(await response.json())
            if (!parsed.success) return unavailable("upstream_error")
            return {
              available: true,
              plan: parsed.data.plan_type ?? null,
              allowed: parsed.data.rate_limit?.allowed ?? null,
              limited: parsed.data.rate_limit?.limit_reached ?? null,
              primary: normalizeWindow(parsed.data.rate_limit?.primary_window),
              secondary: normalizeWindow(parsed.data.rate_limit?.secondary_window),
              reason: null,
            }
          }).pipe(Effect.catch(() => Effect.succeed(unavailable("upstream_error"))))
        }),
    )
    .post(
      "/:providerID/oauth/authorize",
      describeRoute({
        summary: "OAuth authorize",
        description: "Initiate OAuth authorization for a specific AI provider to get an authorization URL.",
        operationId: "provider.oauth.authorize",
        responses: {
          200: {
            description: "Authorization URL and method",
            content: {
              "application/json": {
                schema: resolver(ProviderAuth.Authorization.zod.optional()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod.meta({ description: "Provider ID" }),
        }),
      ),
      validator("json", ProviderAuth.AuthorizeInput.zod),
      async (c) =>
        jsonRequest("ProviderRoutes.oauth.authorize", c, function* () {
          const providerID = c.req.valid("param").providerID
          const { method, inputs } = c.req.valid("json")
          const svc = yield* ProviderAuth.Service
          return yield* svc.authorize({
            providerID,
            method,
            inputs,
          })
        }),
    )
    .post(
      "/:providerID/oauth/callback",
      describeRoute({
        summary: "OAuth callback",
        description: "Handle the OAuth callback from a provider after user authorization.",
        operationId: "provider.oauth.callback",
        responses: {
          200: {
            description: "OAuth callback processed successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "param",
        z.object({
          providerID: ProviderID.zod.meta({ description: "Provider ID" }),
        }),
      ),
      validator("json", ProviderAuth.CallbackInput.zod),
      async (c) =>
        jsonRequest("ProviderRoutes.oauth.callback", c, function* () {
          const providerID = c.req.valid("param").providerID
          const { method, code } = c.req.valid("json")
          const svc = yield* ProviderAuth.Service
          yield* svc.callback({
            providerID,
            method,
            code,
          })
          return true
        }),
    ),
)
