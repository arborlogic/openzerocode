import { describe, it } from "node:test"
import assert from "node:assert"
import { buildAutoLoopSupervisorPrompt, formatAutoLoopDuration, formatAutoLoopEstimatedEnd, parseAutoLoopDuration, parseAutoLoopSupervisorDecision } from "./autoloop"

describe("autoloop helpers", () => {
  it("parses common duration formats", () => {
    assert.equal(parseAutoLoopDuration("5m")?.ms, 5 * 60_000)
    assert.equal(parseAutoLoopDuration("1h")?.ms, 60 * 60_000)
    assert.equal(parseAutoLoopDuration("30s")?.ms, 30_000)
    assert.equal(parseAutoLoopDuration("2 days")?.ms, undefined)
    assert.equal(parseAutoLoopDuration("0m"), undefined)
  })

  it("formats duration labels", () => {
    assert.equal(formatAutoLoopDuration(5 * 60_000), "5m")
    assert.equal(formatAutoLoopDuration(60 * 60_000), "1h")
    assert.equal(formatAutoLoopDuration(30_000), "30s")
  })

  it("formats autorun takeover end as a local timestamp with timezone", () => {
    const label = formatAutoLoopEstimatedEnd(new Date(2026, 0, 2, 3, 4, 5).getTime())

    assert.match(label, /^autorun 接管到 2026-01-02 03:04:05 GMT[+-]\d{2}:\d{2}$/)
    assert.ok(!label.includes("下一次自動執行"))
  })

  it("supervisor prompt includes safety rules and JSON schema", () => {
    const prompt = buildAutoLoopSupervisorPrompt("5m")
    assert.ok(prompt.includes("supervisor"))
    assert.ok(prompt.includes("5m"))
    assert.ok(prompt.includes('"confidence"'))
    assert.ok(prompt.includes('"instruction"'))
    assert.ok(prompt.includes("confidence"))
    assert.ok(prompt.includes("low"))
  })

  it("parses valid high-confidence supervisor JSON", () => {
    const result = parseAutoLoopSupervisorDecision(
      '{"confidence":"high","instruction":"Run the tests and fix failures","reason":"tests were failing last step"}'
    )
    assert.equal(result.confidence, "high")
    assert.equal(result.instruction, "Run the tests and fix failures")
    assert.equal(result.reason, "tests were failing last step")
  })

  it("parses valid low-confidence supervisor JSON", () => {
    const result = parseAutoLoopSupervisorDecision(
      '{"confidence":"low","instruction":"","reason":"requirements ambiguous"}'
    )
    assert.equal(result.confidence, "low")
  })

  it("parses pending-confidence supervisor JSON", () => {
    const result = parseAutoLoopSupervisorDecision(
      '{"confidence":"pending","instruction":"Commit the safe-write docs as a standalone commit","reason":"AI recommended option A"}'
    )
    assert.equal(result.confidence, "pending")
    assert.equal(result.instruction, "Commit the safe-write docs as a standalone commit")
    assert.equal(result.reason, "AI recommended option A")
  })

  it("supervisor prompt describes pending confidence", () => {
    const prompt = buildAutoLoopSupervisorPrompt("5m")
    assert.ok(prompt.includes("pending"))
    assert.ok(prompt.includes("3 minutes"))
    assert.ok(prompt.includes("recommendation"))
  })

  it("strips markdown code fences before parsing", () => {
    const result = parseAutoLoopSupervisorDecision(
      '```json\n{"confidence":"high","instruction":"Check types","reason":"last step finished"}\n```'
    )
    assert.equal(result.confidence, "high")
    assert.equal(result.instruction, "Check types")
  })

  it("defaults to low confidence on invalid JSON", () => {
    const result = parseAutoLoopSupervisorDecision("not json at all")
    assert.equal(result.confidence, "low")
    assert.ok(result.reason.includes("not valid JSON"))
  })

  it("defaults to low confidence when instruction is missing", () => {
    const result = parseAutoLoopSupervisorDecision('{"confidence":"high","instruction":""}')
    assert.equal(result.confidence, "low")
  })
})
