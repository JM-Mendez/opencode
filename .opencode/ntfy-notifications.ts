import type { Plugin } from "@opencode-ai/plugin"

export const NtfyNotificationsPlugin: Plugin = async ({ project, directory }, options) => {
  const topic = (typeof options?.topic === "string" && options.topic) || process.env.NTFY_TOPIC
  if (!topic) {
    console.warn("[ntfy-notifications] No topic configured. Set options.topic or NTFY_TOPIC env var.")
    return {}
  }

  const server = typeof options?.server === "string" ? options.server : "https://ntfy.sh"
  const baseUrl = server.replace(/\/+$/, "")
  const url = `${baseUrl}/${topic}`
  const defaultPriority = typeof options?.priority === "number" ? options.priority : 3
  const projectName = project?.name ?? directory

  const enabledEvents = (() => {
    if (Array.isArray(options?.events)) return new Set(options.events as string[])
    return new Set(["session.status", "session.idle", "session.error", "question.asked"])
  })()

  const titlePrefix = typeof options?.titlePrefix === "string" ? options.titlePrefix : "opencode"

  const sessionLabel = (sessionID?: string) => {
    if (!sessionID) return projectName
    return `${projectName} (${sessionID.slice(0, 8)})`
  }

  const send = async (title: string, message: string, priority?: number, tags?: string[]) => {
    const headers: Record<string, string> = {
      Title: title,
      Priority: String(priority ?? defaultPriority),
    }
    if (tags?.length) headers.Tags = tags.join(",")

    try {
      const res = await fetch(url, { method: "POST", body: message, headers })
      if (!res.ok) console.warn(`[ntfy-notifications] Failed: ${res.status} ${res.statusText}`)
    } catch (err) {
      console.warn("[ntfy-notifications] Error:", err)
    }
  }

  return {
    event: async ({ event }) => {
      if (!enabledEvents.has(event.type)) return

      switch (event.type) {
        case "session.status": {
          const status = event.properties.status
          if (status.type === "busy") {
            await send(`${titlePrefix}: busy`, `${sessionLabel(event.properties.sessionID)} is working`, 2, ["robot"])
            return
          }
          if (status.type === "retry") {
            await send(
              `${titlePrefix}: retry`,
              `${sessionLabel(event.properties.sessionID)} retry ${status.attempt}: ${status.message}`,
              4,
              ["warning"],
            )
            return
          }
          return
        }
        case "session.idle": {
          await send(`${titlePrefix}: completed`, `${sessionLabel(event.properties.sessionID)} completed`, 3, ["white_check_mark"])
          return
        }
        case "session.error": {
          const error = event.properties.error
          const msg =
            typeof error === "object" && error !== null && "data" in error && typeof error.data === "object" && error.data !== null && "message" in error.data
              ? String(error.data.message)
              : typeof error === "object" && error !== null && "message" in error
                ? String(error.message)
                : "Unknown error"
          await send(`${titlePrefix}: error`, `${sessionLabel(event.properties.sessionID)} failed: ${msg}`, 5, ["x"])
          return
        }
        case "question.asked": {
          const first = event.properties.questions[0]
          const text = first?.question ?? first?.header ?? "A question needs your answer"
          await send(`${titlePrefix}: question`, `${sessionLabel(event.properties.sessionID)} needs input: ${text}`, 4, ["question"])
          return
        }
      }
    },
  }
}
