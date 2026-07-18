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
} from "./autopilot"

describe("autopilot helpers", () => {
  it("uses distinct labels for each Autopilot mode", () => {
    assert.equal(autopilotModeLabel("off"), "Off")
    assert.equal(autopilotModeLabel("standard"), "Standard")
    assert.equal(autopilotModeLabel("proactive"), "Proactive")
    assert.equal(autopilotModeLabel("execute"), "Execute Plan")
  })

  it("describes an event-driven continuation check", () => {
    const prompt = buildAutopilotSupervisorPrompt("standard")
    assert.ok(prompt.includes("routine replies"))
    assert.ok(prompt.includes("latest assistant response"))
    assert.ok(prompt.includes("not a scheduled or polling task"))
    assert.ok(prompt.includes('"confidence"'))
  })

  it("only allows routine, safe continuation at high confidence", () => {
    const prompt = buildAutopilotSupervisorPrompt("standard")
    assert.ok(prompt.includes("safe, reversible, and repo-local"))
    assert.ok(prompt.includes("real product, design, or requirements decision"))
    assert.ok(prompt.includes("Autopilot mode: STANDARD"))
    assert.ok(prompt.includes("do not plan a new task"))
  })

  it("proactive mode advances only work aligned with the existing plan", () => {
    const prompt = buildAutopilotSupervisorPrompt("proactive")
    assert.ok(prompt.includes("Autopilot mode: PROACTIVE"))
    assert.ok(prompt.includes("existing plan as the scope boundary and source of truth"))
    assert.ok(prompt.includes("quickly compare that proposal with the existing plan"))
    assert.ok(prompt.includes("clearly advances a specific unfinished plan item"))
    assert.ok(prompt.includes("conflicts with, expands, reprioritizes, or is not clearly traceable"))
    assert.ok(prompt.includes("When uncertain, pause"))
    assert.ok(prompt.includes("no identifiable existing plan"))
    assert.ok(prompt.includes("Do not bootstrap a new roadmap"))
    assert.ok(prompt.includes("name the plan item it advances"))
    assert.ok(prompt.includes("preserve existing API/client contracts"))
    assert.ok(prompt.includes("Review recent Autopilot-sent prompts"))
    assert.ok(prompt.includes("Never send two consecutive generic recommendation requests"))
    assert.ok(prompt.includes("Do not pause merely because the proposed prompt would benefit from routine implementation safeguards"))
    assert.ok(prompt.includes("Those are completion steps, not evidence of more planned product work"))
    assert.ok(prompt.includes("Use a verification-first prompt only when"))
    assert.ok(prompt.includes("Do not invent speculative features"))
  })

  it("asks for a recommendation without authorizing implementation when a report has none", () => {
    const prompt = buildAutopilotSupervisorPrompt("proactive")
    assert.ok(prompt.includes("Do you have a recommendation for what to do next?"))
    assert.ok(prompt.includes("Do not implement it yet"))
    assert.ok(prompt.includes("Never combine the recommendation request with permission to start implementation"))
    assert.ok(prompt.includes("either an aligned implementation prompt or a low-confidence pause"))
  })

  it("executes approved TODOs continuously and defers review until the end", () => {
    const prompt = buildAutopilotSupervisorPrompt("execute")
    assert.ok(prompt.includes("Autopilot mode: EXECUTE PLAN"))
    assert.ok(prompt.includes("TODO list, implementation plan, roadmap, or ordered task list"))
    assert.ok(prompt.includes("Do not ask the coding agent to recommend, discover, prioritize, explain, review, or re-plan"))
    assert.ok(prompt.includes("next incomplete approved task"))
    assert.ok(prompt.includes("Do not request per-task code review, broad repository review"))
    assert.ok(prompt.includes("integrated verification and a single focused review"))
  })

  it("keeps proactive planning out of standard mode", () => {
    const prompt = buildAutopilotSupervisorPrompt("standard")
    assert.ok(!prompt.includes("existing plan as the scope boundary and source of truth"))
    assert.ok(!prompt.includes("Do you have a recommendation for what to do next?"))
    assert.ok(!prompt.includes("Never combine the recommendation request with permission to start implementation"))
    assert.ok(!prompt.includes("Never send two consecutive generic recommendation requests"))
  })

  it("parses a high-confidence next prompt", () => {
    const result = parseAutopilotDecision(
      '{"confidence":"high","instruction":"Run the tests and fix any failures","reason":"routine verification step"}',
    )
    assert.equal(result.confidence, "high")
    assert.equal(result.instruction, "Run the tests and fix any failures")
  })

  it("parses a low-confidence pause", () => {
    const result = parseAutopilotDecision(
      '{"confidence":"low","instruction":"","reason":"a product decision is required"}',
    )
    assert.equal(result.confidence, "low")
    assert.equal(result.instruction, "")
  })

  it("strips markdown fences", () => {
    const result = parseAutopilotDecision(
      '```json\n{"confidence":"high","instruction":"Continue with the recommended refactor","reason":"clear recommendation"}\n```',
    )
    assert.equal(result.confidence, "high")
  })

  it("rejects pending decisions and missing instructions", () => {
    assert.equal(parseAutopilotDecision('{"confidence":"pending","instruction":"Wait"}').confidence, "low")
    assert.equal(parseAutopilotDecision('{"confidence":"high","instruction":""}').confidence, "low")
  })

  it("defaults to low confidence on invalid JSON", () => {
    const result = parseAutopilotDecision("not json")
    assert.equal(result.confidence, "low")
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

  it("defines proactive rate-limit backoff delays up to 8h45m total", () => {
    assert.deepEqual(
      AUTOPILOT_RATE_LIMIT_BACKOFF_MS.map((ms) => ms / 60_000),
      [5, 20, 60, 80, 120, 240],
    )
    assert.equal(AUTOPILOT_RATE_LIMIT_TOTAL_WAIT_MS / 60_000, 525)
  })

  it("retries rate limits for plan-advancing modes only", () => {
    assert.equal(retriesAutopilotRateLimits("off"), false)
    assert.equal(retriesAutopilotRateLimits("standard"), false)
    assert.equal(retriesAutopilotRateLimits("proactive"), true)
    assert.equal(retriesAutopilotRateLimits("execute"), true)
  })

  it("adds bounded jitter to proactive rate-limit retry delays", () => {
    assert.equal(autopilotRateLimitDelayMs(0, () => 0), 4.5 * 60_000)
    assert.equal(autopilotRateLimitDelayMs(0, () => 1), 5.5 * 60_000)
    assert.equal(autopilotRateLimitDelayMs(5, () => 0), 238 * 60_000)
    assert.equal(autopilotRateLimitDelayMs(5, () => 1), 242 * 60_000)
    assert.equal(autopilotRateLimitDelayMs(6, () => 0.5), undefined)
  })

  it("formats proactive rate-limit retry delays for status text", () => {
    assert.equal(formatAutopilotRetryDelay(5 * 60_000), "5m")
    assert.equal(formatAutopilotRetryDelay(80 * 60_000), "1h20m")
    assert.equal(formatAutopilotRetryDelay(240 * 60_000), "4h")
  })

  it("formats proactive notice timestamps as HH:mm", () => {
    assert.equal(formatAutopilotNoticeTime(new Date(2026, 6, 15, 9, 5, 42)), "09:05")
    assert.equal(formatAutopilotNoticeTime(new Date(2026, 6, 15, 23, 59, 0)), "23:59")
  })
})
