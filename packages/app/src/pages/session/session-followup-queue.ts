import type { Message, SessionStatus } from "@opencode-ai/sdk/v2/client"

type FollowupAssistantMessage = Pick<Extract<Message, { role: "assistant" }>, "id" | "role" | "time" | "finish">
type FollowupUserMessage = Pick<Extract<Message, { role: "user" }>, "id" | "role" | "time">
type FollowupMessage = FollowupAssistantMessage | FollowupUserMessage

const idle = { type: "idle" as const }

export const hasActiveAssistantTurn = (messages: FollowupMessage[]) => {
  const latestAssistant = messages.findLast((item) => item.role === "assistant")
  return !!latestAssistant && (typeof latestAssistant.time.completed !== "number" || latestAssistant.finish === "tool-calls")
}

export const isFollowupQueueActive = (input: {
  sessionStatus?: SessionStatus
  messages: FollowupMessage[]
}) => (input.sessionStatus ?? idle).type !== "idle" || hasActiveAssistantTurn(input.messages)

export const isFollowupQueueEnabled = (input: {
  followupMode: "queue" | "steer"
  sessionID?: string
  sessionStatus?: SessionStatus
  messages: FollowupMessage[]
  blocked: boolean
  childSession: boolean
}) =>
  input.followupMode === "queue" &&
  !!input.sessionID &&
  isFollowupQueueActive(input) &&
  !input.blocked &&
  !input.childSession

export const shouldDrainQueuedFollowup = (input: {
  sessionID?: string
  currentSessionID?: string
  sessionStatus?: SessionStatus
  messages: FollowupMessage[]
  queuedCount: number
  followupPending: boolean
  blocked: boolean
  childSession: boolean
  failedFollowupID?: string
  paused: boolean
}) => {
  if (!input.sessionID) return false
  if (input.currentSessionID !== input.sessionID) return false
  if (input.queuedCount <= 0) return false
  if (input.followupPending) return false
  if (input.failedFollowupID) return false
  if (input.paused) return false
  if (input.childSession) return false
  if (input.blocked) return false
  if (isFollowupQueueActive(input)) return false
  return true
}
