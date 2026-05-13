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
