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
  return Math.max(0, Math.round(text.length / 4))
}

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const cfg = getModelConfig(model)
  if (!cfg.pricing) return 0
  return (inputTokens * cfg.pricing.input + outputTokens * cfg.pricing.output) / 1_000_000
}
