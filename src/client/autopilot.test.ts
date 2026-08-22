import { describe, it } from "node:test"
import assert from "node:assert"
import {
  AUTOPILOT_RATE_LIMIT_BACKOFF_MS,
  AUTOPILOT_RATE_LIMIT_TOTAL_WAIT_MS,
  autopilotRateLimitDelayMs,
  autopilotModeLabel,
  canScheduleAutopilotContinuation,
  buildAutopilotSupervisorPrompt,
  formatAutopilotNoticeTime,
  formatAutopilotRetryDelay,
  parseAutopilotDecision,
  retriesAutopilotRateLimits,
  shouldAutopilotConsultOnOutcome,
} from "./autopilot"

describe("autopilot helpers", () => {
  it("uses distinct labels for each Autopilot mode", () => {
    assert.equal(autopilotModeLabel("off"), "Off")
    assert.equal(autopilotModeLabel("standard"), "Standard")
    assert.equal(autopilotModeLabel("goal"), "Goal")
  })

  it("describes an event-driven continuation check", () => {
    const prompt = buildAutopilotSupervisorPrompt("standard")
    assert.ok(prompt.includes("routine replies"))
    assert.ok(prompt.includes("latest assistant response"))
    assert.ok(prompt.includes("not a scheduled or polling task"))
    assert.ok(prompt.includes('"action"'))
    assert.ok(prompt.includes('"suggest"'))
  })

  it("only allows routine, safe continuation in standard mode", () => {
    const prompt = buildAutopilotSupervisorPrompt("standard")
    assert.ok(prompt.includes("safe, reversible, and repo-local"))
    assert.ok(prompt.includes("real product, design, or requirements decision"))
    assert.ok(prompt.includes("Autopilot mode: STANDARD"))
    assert.ok(prompt.includes("do not plan a new task"))
    assert.ok(prompt.includes('Use "accept" once the current requested task is complete'))
    assert.ok(prompt.includes('Use "suggest" when the assistant asks permission to run tests'))
  })

  it("keeps standard mode from planning new tasks", () => {
    const prompt = buildAutopilotSupervisorPrompt("standard")
    assert.ok(!prompt.includes("Autopilot mode: GOAL"))
    assert.ok(!prompt.includes("drive the goal"))
  })

  it("goal mode drives an approved goal to completion and stops when done", () => {
    const prompt = buildAutopilotSupervisorPrompt("goal")
    assert.ok(prompt.includes("Autopilot mode: GOAL"))
    assert.ok(prompt.includes("scope boundary and source of truth"))
    assert.ok(prompt.includes("use \"accept\" and stop"))
    assert.ok(prompt.includes("planned sub-step of the approved goal"))
    assert.ok(prompt.includes("use \"suggest\" with its concrete prompt"))
    assert.ok(prompt.includes('Do not use "direct" to bootstrap new roadmap items'))
    assert.ok(prompt.includes("Do not invent speculative features"))
  })

  it("does not leak goal-specific planning into standard mode", () => {
    const prompt = buildAutopilotSupervisorPrompt("standard")
    assert.ok(!prompt.includes("scope boundary and source of truth"))
    assert.ok(!prompt.includes("planned sub-step of the approved goal"))
  })

  it("parses a direct continuation", () => {
    const result = parseAutopilotDecision(
      '{"action":"direct","instruction":"Run the tests and fix any failures","reason":"routine verification step"}',
    )
    assert.deepEqual(result, { action: "direct", instruction: "Run the tests and fix any failures", reason: "routine verification step" })
  })

  it("parses a suggestion and an acceptance", () => {
    const suggestion = parseAutopilotDecision(
      '{"action":"suggest","instruction":"Add a README section","reason":"new idea outside the approved goal"}',
    )
    assert.deepEqual(suggestion, { action: "suggest", instruction: "Add a README section", reason: "new idea outside the approved goal" })
    const accepted = parseAutopilotDecision('{"action":"accept","reason":"goal complete"}')
    assert.deepEqual(accepted, { action: "accept", reason: "goal complete" })
  })

  it("strips markdown fences", () => {
    const result = parseAutopilotDecision(
      '```json\n{"action":"direct","instruction":"Continue with the recommended refactor","reason":"clear recommendation"}\n```',
    )
    assert.equal(result.action, "direct")
    if (result.action === "direct") {
      assert.equal(result.instruction, "Continue with the recommended refactor")
    }
  })

  it("rejects invalid actions and missing instructions as blocked", () => {
    assert.deepEqual(parseAutopilotDecision('{"action":"high","instruction":"Wait"}'), { action: "blocked", reason: "supervisor output was not valid JSON" })
    assert.deepEqual(parseAutopilotDecision('{"action":"direct","instruction":""}'), { action: "blocked", reason: "supervisor output was not valid JSON" })
    assert.deepEqual(parseAutopilotDecision('{"action":"suggest","instruction":""}'), { action: "blocked", reason: "supervisor output was not valid JSON" })
  })

  it("defaults to blocked on invalid JSON", () => {
    const result = parseAutopilotDecision("not json")
    assert.equal(result.action, "blocked")
    assert.ok(result.reason.includes("not valid JSON"))
  })

  it("only schedules a continuation from a fully idle Autopilot state", () => {
    const idleState = {
      enabled: true,
      supervisorRunning: false,
      rateLimitRetryPending: false,
      running: false,
      compacting: false,
      awaitingApproval: false,
      queuedInputCount: 0,
      inputQueueDraining: false,
    }

    assert.equal(canScheduleAutopilotContinuation(idleState), true)
    for (const blockedField of Object.keys(idleState) as Array<keyof typeof idleState>) {
      if (blockedField === "enabled" || blockedField === "queuedInputCount") {
        assert.equal(canScheduleAutopilotContinuation({ ...idleState, [blockedField]: blockedField === "enabled" ? false : 1 }), false)
      } else {
        assert.equal(canScheduleAutopilotContinuation({ ...idleState, [blockedField]: true }), false)
      }
    }
  })

  it("defines goal rate-limit backoff delays up to 8h45m total", () => {
    assert.deepEqual(
      AUTOPILOT_RATE_LIMIT_BACKOFF_MS.map((ms) => ms / 60_000),
      [5, 20, 60, 80, 120, 240],
    )
    assert.equal(AUTOPILOT_RATE_LIMIT_TOTAL_WAIT_MS / 60_000, 525)
  })

  it("retries rate limits for goal-advancing modes only", () => {
    assert.equal(retriesAutopilotRateLimits("off"), false)
    assert.equal(retriesAutopilotRateLimits("standard"), false)
    assert.equal(retriesAutopilotRateLimits("goal"), true)
  })

  it("adds bounded jitter to goal rate-limit retry delays", () => {
    assert.equal(autopilotRateLimitDelayMs(0, () => 0), 4.5 * 60_000)
    assert.equal(autopilotRateLimitDelayMs(0, () => 1), 5.5 * 60_000)
    assert.equal(autopilotRateLimitDelayMs(5, () => 0), 238 * 60_000)
    assert.equal(autopilotRateLimitDelayMs(5, () => 1), 242 * 60_000)
    assert.equal(autopilotRateLimitDelayMs(6, () => 0.5), undefined)
  })

  it("formats goal rate-limit retry delays for status text", () => {
    assert.equal(formatAutopilotRetryDelay(5 * 60_000), "5m")
    assert.equal(formatAutopilotRetryDelay(80 * 60_000), "1h20m")
    assert.equal(formatAutopilotRetryDelay(240 * 60_000), "4h")
  })

  it("formats goal notice timestamps as HH:mm", () => {
    assert.equal(formatAutopilotNoticeTime(new Date(2026, 6, 15, 9, 5, 42)), "09:05")
    assert.equal(formatAutopilotNoticeTime(new Date(2026, 6, 15, 23, 59, 0)), "23:59")
  })

  it("does not consult autopilot on a clean or absent outcome", () => {
    assert.equal(shouldAutopilotConsultOnOutcome(undefined), false)
    assert.equal(shouldAutopilotConsultOnOutcome({ kind: "completed" }), false)
  })

  it("consults autopilot on every non-completed run outcome", () => {
    assert.equal(shouldAutopilotConsultOnOutcome({ kind: "step_limit_reached", steps: 50, maxSteps: 50 }), true)
    assert.equal(shouldAutopilotConsultOnOutcome({ kind: "provider_error", message: "offline", signature: "offline" }), true)
    assert.equal(shouldAutopilotConsultOnOutcome({ kind: "tool_error", tool: "bash", message: "failed", signature: "bash::failed" }), true)
    assert.equal(shouldAutopilotConsultOnOutcome({ kind: "replan_needed", reason: "stuck", recentErrors: [] }), true)
  })

  it("does not restart autopilot after an abort or internal application error", () => {
    assert.equal(shouldAutopilotConsultOnOutcome({ kind: "aborted" }), false)
    assert.equal(shouldAutopilotConsultOnOutcome({ kind: "internal_error", message: "unexpected" }), false)
  })
})
