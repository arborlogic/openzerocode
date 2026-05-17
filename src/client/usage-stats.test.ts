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
})
