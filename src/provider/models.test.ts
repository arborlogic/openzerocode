import { describe, it } from "node:test"
import assert from "node:assert"
import { getKnownModelConfig, getModelConfig, estimateTokens, estimateCost } from "./models"

describe("getKnownModelConfig", () => {
  it("returns config for known models", () => {
    const cfg = getKnownModelConfig("gpt-4o")
    assert.ok(cfg)
    assert.equal(cfg?.contextLimit, 128_000)
  })

  it("returns undefined for unknown models", () => {
    assert.equal(getKnownModelConfig("unknown-model"), undefined)
  })

  it("returns config for claude models with thinking suffix", () => {
    const cfg = getKnownModelConfig("claude-sonnet-4-20250514-thinking")
    assert.ok(cfg)
    assert.equal(cfg?.contextLimit, 200_000)
  })
})

describe("getModelConfig", () => {
  it("returns default config for unknown models", () => {
    const cfg = getModelConfig("nonexistent")
    assert.equal(cfg.contextLimit, 128_000)
    assert.deepEqual(cfg.pricing, { input: 0, output: 0 })
  })

  it("returns known config for known models", () => {
    const cfg = getModelConfig("gpt-4o-mini")
    assert.equal(cfg.contextLimit, 128_000)
    assert.equal(cfg.pricing?.input, 0.15)
    assert.equal(cfg.pricing?.output, 0.6)
  })

  it("handles model config without pricing", () => {
    const cfg = getModelConfig("openrouter/auto")
    assert.equal(cfg.contextLimit, 2_000_000)
    assert.equal(cfg.pricing, undefined)
  })
})

describe("estimateTokens", () => {
  it("estimates tokens from text length", () => {
    // ~4 chars per token
    const text = "Hello, world! This is a test."
    const tokens = estimateTokens(text)
    assert.ok(tokens > 0)
    assert.equal(tokens, Math.round(text.length / 4))
  })

  it("returns 0 for empty string", () => {
    assert.equal(estimateTokens(""), 0)
  })

  it("returns at least 0 for negative rounding", () => {
    const result = estimateTokens("a")
    assert.ok(result >= 0)
  })
})

describe("estimateCost", () => {
  it("calculates cost based on token usage", () => {
    const cost = estimateCost("gpt-4o", 1_000, 500)
    // (1000 * 2.5 + 500 * 10) / 1_000_000 = (2500 + 5000) / 1_000_000 = 0.0075
    assert.equal(cost, 0.0075)
  })

  it("returns 0 for unknown models", () => {
    const cost = estimateCost("unknown", 100, 100)
    assert.equal(cost, 0)
  })

  it("returns 0 for models without pricing", () => {
    const cost = estimateCost("openrouter/auto", 100, 100)
    assert.equal(cost, 0)
  })

  it("uses zero pricing for free models", () => {
    const cost = estimateCost("inclusionai/ring-2.6-1t:free", 1000, 1000)
    assert.equal(cost, 0)
  })
})
