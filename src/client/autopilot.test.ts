import { describe, it } from "node:test"
import assert from "node:assert"
import { buildAutopilotSupervisorPrompt, parseAutopilotDecision } from "./autopilot"

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
    assert.ok(prompt.includes("Do not invent speculative features"))
  })

  it("keeps proactive planning out of standard mode", () => {
    const prompt = buildAutopilotSupervisorPrompt("standard")
    assert.ok(!prompt.includes("Ask the current AI to propose the next step first"))
    assert.ok(!prompt.includes("latest assistant response is already a next-step proposal"))
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
})
