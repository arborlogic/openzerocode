import { describe, it } from "node:test"
import assert from "node:assert"
import { aggregateEntries, getSessionBreakdown, type UsageEntry } from "./usage-stats"

describe("usage stats", () => {
  it("aggregates cached input tokens while keeping legacy entries readable", () => {
    const entries: UsageEntry[] = [
      {
        timestamp: 1000,
        provider: "openai",
        keyName: "default",
        model: "gpt-5.4",
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 40,
        sessionId: "s1",
      },
      {
        timestamp: 2000,
        provider: "openai",
        keyName: "default",
        model: "gpt-5.4",
        inputTokens: 80,
        outputTokens: 10,
        sessionId: "s1",
      },
    ]

    const [aggregate] = aggregateEntries(entries)
    assert.equal(aggregate.cachedInputTokens, 40)
    assert.equal(aggregate.totalTokens, 210)

    const [session] = getSessionBreakdown(entries)
    assert.equal(session.totalCachedInputTokens, 40)
    assert.equal(session.recentEntries[0].cachedInputTokens, 0)
    assert.equal(session.recentEntries[1].cachedInputTokens, 40)
  })

  it("limits session results without losing totals or the most recent requests", () => {
    const entry = (sessionId: string, timestamp: number, inputTokens: number): UsageEntry => ({
      timestamp,
      provider: "openai",
      keyName: "default",
      model: "gpt-5.4",
      inputTokens,
      outputTokens: 1,
      sessionId,
    })
    const entries = [
      entry("older", 100, 10),
      entry("newer", 400, 40),
      entry("newer", 200, 20),
      entry("newer", 300, 30),
    ]

    const sessions = getSessionBreakdown(entries, 2, 1)

    assert.equal(sessions.length, 1)
    assert.equal(sessions[0].sessionId, "newer")
    assert.equal(sessions[0].totalRequests, 3)
    assert.equal(sessions[0].totalInputTokens, 90)
    assert.deepEqual(sessions[0].recentEntries.map((row) => row.timestamp), [400, 300])
  })
})
