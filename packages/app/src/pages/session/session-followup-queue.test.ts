import { describe, expect, test } from "bun:test"
import { hasActiveAssistantTurn, isFollowupQueueEnabled, shouldDrainQueuedFollowup } from "./session-followup-queue"

const drainInput = () => ({
  sessionID: "session-1",
  currentSessionID: "session-1",
  sessionStatus: { type: "idle" as const },
  messages: [{ id: "message-1", role: "assistant" as const, time: { created: 1, completed: 2 } }],
  queuedCount: 1,
  followupPending: false,
  blocked: false,
  childSession: false,
  failedFollowupID: undefined,
  paused: false,
})

describe("hasActiveAssistantTurn", () => {
  test("uses the latest assistant message as the visible assistant turn", () => {
    expect(
      hasActiveAssistantTurn([
        { id: "older", role: "assistant", time: { created: 1 } },
        { id: "newer", role: "assistant", time: { created: 2, completed: 3 } },
      ]),
    ).toBe(false)
  })
})

describe("isFollowupQueueEnabled", () => {
  test("requires queue mode, an active session, and no composer blockers", () => {
    expect(
      isFollowupQueueEnabled({
        followupMode: "queue",
        sessionID: "session-1",
        sessionStatus: { type: "busy" },
        messages: [],
        blocked: false,
        childSession: false,
      }),
    ).toBe(true)

    expect(
      isFollowupQueueEnabled({
        followupMode: "queue",
        sessionID: "session-1",
        sessionStatus: { type: "busy" },
        messages: [],
        blocked: true,
        childSession: false,
      }),
    ).toBe(false)

    expect(
      isFollowupQueueEnabled({
        followupMode: "queue",
        sessionID: "session-1",
        sessionStatus: { type: "busy" },
        messages: [],
        blocked: false,
        childSession: true,
      }),
    ).toBe(false)

    expect(
      isFollowupQueueEnabled({
        followupMode: "steer",
        sessionID: "session-1",
        sessionStatus: { type: "busy" },
        messages: [],
        blocked: false,
        childSession: false,
      }),
    ).toBe(false)

    expect(
      isFollowupQueueEnabled({
        followupMode: "queue",
        sessionID: undefined,
        sessionStatus: { type: "busy" },
        messages: [],
        blocked: false,
        childSession: false,
      }),
    ).toBe(false)

    expect(
      isFollowupQueueEnabled({
        followupMode: "queue",
        sessionID: "session-1",
        sessionStatus: { type: "idle" },
        messages: [],
        blocked: false,
        childSession: false,
      }),
    ).toBe(false)
  })
})

describe("shouldDrainQueuedFollowup", () => {
  test("waits for the visible assistant turn to complete before draining queued follow-ups", () => {
    expect(
      shouldDrainQueuedFollowup({
        sessionID: "session-1",
        currentSessionID: "session-1",
        sessionStatus: { type: "idle" },
        messages: [{ id: "message-1", role: "assistant", time: { created: 1 } }],
        queuedCount: 1,
        followupPending: false,
        blocked: false,
        childSession: false,
        failedFollowupID: undefined,
        paused: false,
      }),
    ).toBe(false)

    expect(
      shouldDrainQueuedFollowup({
        sessionID: "session-1",
        currentSessionID: "session-1",
        sessionStatus: { type: "idle" },
        messages: [{ id: "message-1", role: "assistant", time: { created: 1, completed: 2 } }],
        queuedCount: 1,
        followupPending: false,
        blocked: false,
        childSession: false,
        failedFollowupID: undefined,
        paused: false,
      }),
    ).toBe(true)
  })

  test("does not drain while blockers are present", () => {
    expect(shouldDrainQueuedFollowup({ ...drainInput(), blocked: true })).toBe(false)
    expect(shouldDrainQueuedFollowup({ ...drainInput(), childSession: true })).toBe(false)
    expect(shouldDrainQueuedFollowup({ ...drainInput(), paused: true })).toBe(false)
    expect(shouldDrainQueuedFollowup({ ...drainInput(), failedFollowupID: "followup-1" })).toBe(false)
    expect(shouldDrainQueuedFollowup({ ...drainInput(), followupPending: true })).toBe(false)
    expect(shouldDrainQueuedFollowup({ ...drainInput(), currentSessionID: "session-2" })).toBe(false)
  })
})
