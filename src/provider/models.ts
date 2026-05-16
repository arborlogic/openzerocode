export type ModelConfig = {
  contextLimit: number
  pricing?: {
    input: number
    output: number
  }
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
  "gpt-5.4": {
    contextLimit: 1_000_000,
    pricing: { input: 2.5, output: 15 },
  },
  "gpt-5.4-mini": {
    contextLimit: 1_000_000,
    pricing: { input: 0.4, output: 1.6 },
  },
  "gpt-5.4-nano": {
    contextLimit: 1_000_000,
    pricing: { input: 0.1, output: 0.4 },
  },
  "gpt-5.4-codex": {
    contextLimit: 400_000,
    pricing: { input: 0, output: 0 },
  },
  "gpt-5.2": {
    contextLimit: 400_000,
    pricing: { input: 1.75, output: 14 },
  },
  "gpt-5.2-codex": {
    contextLimit: 400_000,
    pricing: { input: 1.75, output: 14 },
  },
  "gpt-5.2-chat-latest": {
    contextLimit: 400_000,
    pricing: { input: 1.75, output: 14 },
  },
  "gpt-5": {
    contextLimit: 400_000,
    pricing: { input: 1.25, output: 10 },
  },
  "gpt-5-mini": {
    contextLimit: 400_000,
    pricing: { input: 0.25, output: 2 },
  },
  "gpt-5-nano": {
    contextLimit: 400_000,
    pricing: { input: 0.05, output: 0.4 },
  },
  "gpt-4o": {
    contextLimit: 128_000,
    pricing: { input: 2.5, output: 10 },
  },
  "gpt-4o-mini": {
    contextLimit: 128_000,
    pricing: { input: 0.15, output: 0.6 },
  },
  "claude-sonnet-4-20250514": {
    contextLimit: 200_000,
    pricing: { input: 3, output: 15 },
  },
  "claude-sonnet-4-20250514-thinking": {
    contextLimit: 200_000,
    pricing: { input: 3, output: 15 },
  },
  "claude-3-5-sonnet-latest": {
    contextLimit: 200_000,
    pricing: { input: 3, output: 15 },
  },
  "claude-3-5-haiku-latest": {
    contextLimit: 200_000,
    pricing: { input: 0.8, output: 4 },
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
}

export function getKnownModelConfig(model: string): ModelConfig | undefined {
  return MODEL_CONFIGS[model]
}

export function getModelConfig(model: string): ModelConfig {
  return MODEL_CONFIGS[model] ?? DEFAULT_CONFIG
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

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const cfg = getModelConfig(model)
  if (!cfg.pricing) return 0
  return (inputTokens * cfg.pricing.input + outputTokens * cfg.pricing.output) / 1_000_000
}
