import { describe, it } from "node:test"
import assert from "node:assert"
import { getKnownModelConfig, getModelConfig, estimateTokens, estimateCost, modelSupportsVision } from "./models"
import type { ModelInfo } from "./types"

describe("getKnownModelConfig", () => {
  it("returns config for known models", () => {
    const cfg = getKnownModelConfig("gpt-4o")
    assert.ok(cfg)
    assert.equal(cfg?.contextLimit, 128_000)
  })

  it("normalizes provider-prefixed model ids", () => {
    const cfg = getKnownModelConfig("openaicodex/gpt-5.4")
    assert.ok(cfg)
    assert.equal(cfg?.contextLimit, 1_000_000)
  })

  it("returns undefined for unknown models", () => {
    assert.equal(getKnownModelConfig("unknown-model"), undefined)
  })

  it("returns config for gpt-5.5 provider-prefixed model ids", () => {
    const cfg = getKnownModelConfig("openaicodex/gpt-5.5")
    assert.ok(cfg)
    assert.equal(cfg?.contextLimit, 1_000_000)
    assert.equal(cfg?.vision, true)
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

  it("uses fallback metadata for unknown models", () => {
    const fallback: ModelInfo = {
      id: "zero/new-runtime-model",
      contextLimit: 128_000,
      pricing: { input: 5, output: 15 },
    }
    const cfg = getModelConfig("zero/new-runtime-model", fallback)
    assert.equal(cfg.contextLimit, 128_000)
    assert.equal(cfg.pricing?.input, 5)
    assert.equal(cfg.pricing?.output, 15)
  })

  it("uses fallback pricing even when only fallback pricing is present", () => {
    const fallback: ModelInfo = {
      id: "zero/some-new-model",
      pricing: { input: 0.2, output: 0.8 },
    }
    const cfg = getModelConfig("zero/some-new-model", fallback)
    assert.equal(cfg.contextLimit, 128_000)
    assert.equal(cfg.pricing?.input, 0.2)
    assert.equal(cfg.pricing?.output, 0.8)
  })

  it("still uses known config over fallback metadata", () => {
    const fallback: ModelInfo = {
      id: "gpt-4o",
      contextLimit: 256_000,
      pricing: { input: 5, output: 15 },
    }
    const cfg = getModelConfig("gpt-4o", fallback)
    assert.equal(cfg.contextLimit, 128_000)
    assert.equal(cfg.pricing?.input, 2.5)
    assert.equal(cfg.pricing?.output, 10)
  })

  it("uses normalized config for provider-prefixed model ids", () => {
    const cfg = getModelConfig("openaicodex/gpt-5.4")
    assert.equal(cfg.contextLimit, 1_000_000)
    assert.equal(cfg.pricing?.input, 2.5)
    assert.equal(cfg.pricing?.output, 15)
  })
})

describe("modelSupportsVision", () => {
  it("treats gpt-5.5 and provider-prefixed gpt-5.5 as vision-capable", () => {
    assert.equal(modelSupportsVision("gpt-5.5"), true)
    assert.equal(modelSupportsVision("openaicodex/gpt-5.5"), true)
  })

  it("does not treat arbitrary unknown models as vision-capable", () => {
    assert.equal(modelSupportsVision("some-text-model"), false)
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
