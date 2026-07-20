import type { ModelInfo } from "./types"

export type ModelConfig = {
  contextLimit: number
  pricing?: {
    input: number
    output: number
    cache_read?: number
  }
  /** Whether the model supports the `reasoning_effort` parameter (e.g. DeepSeek V4 Pro, OpenAI o-series). */
  reasoning?: boolean
  /** Whether the model natively supports image/vision input. */
  vision?: boolean
}

const DEFAULT_CONFIG: ModelConfig = {
  contextLimit: 128_000,
  pricing: { input: 0, output: 0 },
}

const MODEL_CONFIGS: Record<string, ModelConfig> = {
  "big-pickle": {
    contextLimit: 128_000,
    pricing: { input: 0, output: 0 },
  },
  "deepseek-v4-flash": {
    contextLimit: 1_000_000,
    pricing: { input: 0.14, output: 0.28 },
  },
  "deepseek-v4-pro": {
    contextLimit: 1_000_000,
    pricing: { input: 0.435, output: 0.87, cache_read: 0.003625 },
    reasoning: true,
  },
  "gpt-5.5-codex": {
    contextLimit: 400_000,
    pricing: { input: 0, output: 0 },
    vision: true,
  },
  // OpenAI documents a 1,050,000-token context window for the current
  // ChatGPT Codex model family (GPT-5.5 and all GPT-5.6 variants). Keep the
  // usable application budget at 372K to leave room for output and overhead.
  "gpt-5.5": {
    contextLimit: 372_000,
    pricing: { input: 0, output: 0 },
    vision: true,
  },
  "gpt-5.6-sol": {
    contextLimit: 372_000,
    pricing: { input: 0, output: 0 },
    vision: true,
  },
  "gpt-5.6-terra": {
    contextLimit: 372_000,
    pricing: { input: 0, output: 0 },
    vision: true,
  },
  "gpt-5.6-luna": {
    contextLimit: 372_000,
    pricing: { input: 0, output: 0 },
    vision: true,
  },
  "gpt-5.4-codex": {
    contextLimit: 400_000,
    pricing: { input: 0, output: 0 },
    vision: true,
  },
  "gpt-5.2": {
    contextLimit: 400_000,
    pricing: { input: 1.75, output: 14 },
    vision: true,
  },
  "gpt-5.2-codex": {
    contextLimit: 400_000,
    pricing: { input: 1.75, output: 14 },
    vision: true,
  },
  "gpt-5.2-chat-latest": {
    contextLimit: 400_000,
    pricing: { input: 1.75, output: 14 },
    vision: true,
  },
  "gpt-5": {
    contextLimit: 400_000,
    pricing: { input: 1.25, output: 10 },
    vision: true,
  },
  "gpt-5-mini": {
    contextLimit: 400_000,
    pricing: { input: 0.25, output: 2 },
    vision: true,
  },
  "gpt-5-nano": {
    contextLimit: 400_000,
    pricing: { input: 0.05, output: 0.4 },
    vision: true,
  },
  "gpt-4o": {
    contextLimit: 128_000,
    pricing: { input: 2.5, output: 10 },
    vision: true,
  },
  "gpt-4o-mini": {
    contextLimit: 128_000,
    pricing: { input: 0.15, output: 0.6 },
    vision: true,
  },
  "claude-sonnet-4-20250514": {
    contextLimit: 200_000,
    pricing: { input: 3, output: 15 },
    vision: true,
  },
  "claude-sonnet-4-20250514-thinking": {
    contextLimit: 200_000,
    pricing: { input: 3, output: 15 },
    vision: true,
  },
  "claude-3-5-sonnet-latest": {
    contextLimit: 200_000,
    pricing: { input: 3, output: 15 },
    vision: true,
  },
  "claude-3-5-haiku-latest": {
    contextLimit: 200_000,
    pricing: { input: 0.8, output: 4 },
    vision: true,
  },
  "inclusionai/ring-2.6-1t:free": {
    contextLimit: 262_144,
    pricing: { input: 0, output: 0 },
  },
  "baidu/cobuddy:free": {
    contextLimit: 131_072,
    pricing: { input: 0, output: 0 },
  },
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": {
    contextLimit: 256_000,
    pricing: { input: 0, output: 0 },
  },
  "poolside/laguna-xs.2:free": {
    contextLimit: 131_072,
    pricing: { input: 0, output: 0 },
  },
  "openrouter/auto": {
    contextLimit: 2_000_000,
  },
  "grok-build-0.1": {
    contextLimit: 256_000,
    pricing: { input: 1, output: 2, cache_read: 0.2 },
    vision: true,
  },
  "grok-composer-2.5-fast": {
    contextLimit: 256_000,
    pricing: { input: 0, output: 0 },
  },
  "grok-4.5": {
    contextLimit: 500_000,
    pricing: { input: 2, output: 6, cache_read: 0.5 },
    reasoning: true,
    vision: true,
  },
  "grok-4.3": {
    contextLimit: 1_000_000,
    pricing: { input: 1.25, output: 2.5, cache_read: 0.2 },
    reasoning: true,
    vision: true,
  },
  "grok-4.20-0309-reasoning": {
    contextLimit: 1_000_000,
    pricing: { input: 1.25, output: 2.5, cache_read: 0.2 },
    reasoning: true,
    vision: true,
  },
  "grok-4.20-0309-non-reasoning": {
    contextLimit: 1_000_000,
    pricing: { input: 1.25, output: 2.5, cache_read: 0.2 },
    vision: true,
  },
  "grok-4.20-multi-agent-0309": {
    contextLimit: 1_000_000,
    pricing: { input: 1.25, output: 2.5, cache_read: 0.2 },
    reasoning: true,
    vision: true,
  },
}

function normalizeModelConfigKey(model: string): string {
  if (MODEL_CONFIGS[model]) return model

  const slashIndex = model.lastIndexOf("/")
  if (slashIndex === -1) return model

  const candidate = model.slice(slashIndex + 1)
  return MODEL_CONFIGS[candidate] ? candidate : model
}

export function getKnownModelConfig(model: string): ModelConfig | undefined {
  return MODEL_CONFIGS[normalizeModelConfigKey(model)]
}

export function getModelConfig(model: string, fallback?: ModelInfo | ModelConfig): ModelConfig {
  const known = MODEL_CONFIGS[normalizeModelConfigKey(model)]
  if (known) return known

  if (fallback?.contextLimit || fallback?.pricing) {
    return {
      contextLimit: fallback.contextLimit ?? DEFAULT_CONFIG.contextLimit,
      pricing: fallback.pricing ?? DEFAULT_CONFIG.pricing,
    }
  }

  return DEFAULT_CONFIG
}

/** Check if a model natively supports vision/image input. */
export function modelSupportsVision(model: string): boolean {
  const cfg = MODEL_CONFIGS[normalizeModelConfigKey(model)]
  if (cfg?.vision === true) return true

  // Heuristic: unknown models with "vision", "vl", "omni" in name likely support images
  const lower = model.toLowerCase()
  if (/vision|vl[m]?[-_]|\bvl\b|omni/.test(lower)) return true

  return false
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjkCount = 0
  let otherCount = 0
  for (const char of text) {
    if (/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(char)) {
      cjkCount++
    } else {
      otherCount++
    }
  }
  // CJK characters typically take 1–2 tokens per char (~0.5 token each)
  // ASCII/non-CJK typically average 4 chars per token (~0.25 token each)
  return Math.max(0, Math.round(cjkCount / 2 + otherCount / 4))
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number, cachedInputTokens?: number): number {
  const cfg = getModelConfig(model)
  if (!cfg.pricing) return 0
  const cacheRead = cachedInputTokens ?? 0
  const regularInput = inputTokens - cacheRead
  const cacheCost = cacheRead * (cfg.pricing.cache_read ?? cfg.pricing.input)
  const regularCost = regularInput * cfg.pricing.input
  const outputCost = outputTokens * cfg.pricing.output
  return ((regularInput > 0 ? regularCost : 0) + cacheCost + outputCost) / 1_000_000
}
