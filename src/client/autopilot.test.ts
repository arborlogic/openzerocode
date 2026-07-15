import { describe, it } from "node:test"
import assert from "node:assert"
import {
  AUTOPILOT_RATE_LIMIT_BACKOFF_MS,
  AUTOPILOT_RATE_LIMIT_TOTAL_WAIT_MS,
  autopilotRateLimitDelayMs,
  buildAutopilotSupervisorPrompt,
  formatAutopilotNoticeTime,
  formatAutopilotRetryDelay,
  parseAutopilotDecision,
} from "./autopilot"

describe("autopilot helpers", () => {
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

  it("proactive mode continues after a bounded subtask when broader work remains", () => {
    const prompt = buildAutopilotSupervisorPrompt("proactive")
    assert.ok(prompt.includes("Autopilot mode: PROACTIVE"))
    assert.ok(prompt.includes("Completing one implementation request is not the same as completing the overall project objective"))
    assert.ok(prompt.includes("Ask the current AI to propose the next step first"))
    assert.ok(prompt.includes("start implementing it only if the proposal is clearly safe"))
    assert.ok(prompt.includes("latest assistant response is already a next-step proposal"))
    assert.ok(prompt.includes("refine the next prompt before sending it"))
    assert.ok(prompt.includes("preserve existing API/client contracts"))
    assert.ok(prompt.includes("recent Autopilot-sent user prompts"))
    assert.ok(prompt.includes("speculative micro-optimization"))
    assert.ok(prompt.includes("fresh profiling, bug reports, failing tests, or roadmap evidence"))
    assert.ok(prompt.includes("stop before overdeveloping a subsystem"))
    assert.ok(prompt.includes("Do not pause merely because the proposed prompt would benefit from routine implementation safeguards"))
    assert.ok(prompt.includes("Those are completion steps, not product progress"))
    assert.ok(prompt.includes("Use a verification-first prompt only when"))
    assert.ok(prompt.includes("small vertical slice that moves a real production code path"))
    assert.ok(prompt.includes("replace or reduce an existing coupling"))
    assert.ok(prompt.includes("Do not use Proactive Autopilot to request a progress explanation"))
    assert.ok(prompt.includes("Do not invent speculative features"))
  })

  it("keeps proactive planning out of standard mode", () => {
    const prompt = buildAutopilotSupervisorPrompt("standard")
    assert.ok(!prompt.includes("Ask the current AI to propose the next step first"))
    assert.ok(!prompt.includes("latest assistant response is already a next-step proposal"))
    assert.ok(!prompt.includes("refine the next prompt before sending it"))
    assert.ok(!prompt.includes("recent Autopilot-sent user prompts"))
    assert.ok(!prompt.includes("speculative micro-optimization"))
    assert.ok(!prompt.includes("Those are completion steps, not product progress"))
    assert.ok(!prompt.includes("small vertical slice that moves a real production code path"))
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

  it("defines proactive rate-limit backoff delays up to 8h45m total", () => {
    assert.deepEqual(
      AUTOPILOT_RATE_LIMIT_BACKOFF_MS.map((ms) => ms / 60_000),
      [5, 20, 60, 80, 120, 240],
    )
    assert.equal(AUTOPILOT_RATE_LIMIT_TOTAL_WAIT_MS / 60_000, 525)
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
