import type { Message, ModelInfo, ReasoningEffort } from "./types"

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
    reasoning: true,
    vision: true,
  },
  // Match the standard context window advertised by the current Codex model
  // catalogue. GPT-5.6 can expose a larger opt-in window, but this client does
  // not currently send that opt-in, so budgeting against 872K would overrun.
  "gpt-5.5": {
    contextLimit: 272_000,
    pricing: { input: 0, output: 0 },
    reasoning: true,
    vision: true,
  },
  "gpt-5.6-sol": {
    contextLimit: 272_000,
    pricing: { input: 0, output: 0 },
    reasoning: true,
    vision: true,
  },
  "gpt-5.6-terra": {
    contextLimit: 272_000,
    pricing: { input: 0, output: 0 },
    reasoning: true,
    vision: true,
  },
  "gpt-5.6-luna": {
    contextLimit: 272_000,
    pricing: { input: 0, output: 0 },
    reasoning: true,
    vision: true,
  },
  "gpt-5.4-codex": {
    contextLimit: 400_000,
    pricing: { input: 0, output: 0 },
    reasoning: true,
    vision: true,
  },
  "gpt-5.4": {
    contextLimit: 400_000,
    pricing: { input: 0, output: 0 },
    reasoning: true,
    vision: true,
  },
  "gpt-5.4-mini": {
    contextLimit: 400_000,
    pricing: { input: 0, output: 0 },
    reasoning: true,
    vision: true,
  },
  "gpt-5.3-codex": {
    contextLimit: 400_000,
    pricing: { input: 0, output: 0 },
    reasoning: true,
    vision: true,
  },
  "gpt-5.3-codex-spark": {
    contextLimit: 400_000,
    pricing: { input: 0, output: 0 },
    reasoning: true,
    vision: true,
  },
  "gpt-5.2": {
    contextLimit: 400_000,
    pricing: { input: 1.75, output: 14 },
    reasoning: true,
    vision: true,
  },
  "gpt-5.2-codex": {
    contextLimit: 400_000,
    pricing: { input: 1.75, output: 14 },
    reasoning: true,
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

/**
 * Returns the usable context limit, preferring valid provider metadata over
 * the static catalogue. Gateways may impose a lower per-model context window.
 */
export function getEffectiveContextLimit(model: string, metadata?: ModelInfo): number {
  const contextLimit = metadata?.contextLimit
  if (typeof contextLimit === "number" && Number.isFinite(contextLimit) && contextLimit > 0) {
    return contextLimit
  }
  return getModelConfig(model).contextLimit
}

/**
 * Return a reasoning effort accepted by the selected model.
 *
 * Advanced levels are model-specific: GPT-5.6 accepts both `xhigh` and `max`,
 * while older Codex models accept only low/medium/high. DeepSeek V4 Pro keeps
 * its existing `max` level; other advanced values fall back safely to `high`.
 */
export function normalizeReasoningEffort(model: string, effort?: ReasoningEffort): ReasoningEffort | undefined {
  if (!effort || !getModelConfig(model).reasoning) return undefined
  const normalizedModel = normalizeModelConfigKey(model).toLowerCase()
  if ((effort === "xhigh" || effort === "max") && /^gpt-5\.6(?:-|$)/.test(normalizedModel)) return effort
  if (effort === "max" && normalizedModel === "deepseek-v4-pro") return effort
  if (effort === "xhigh" || effort === "max") return "high"
  return effort
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

/**
 * Conservative, bounded allowance for one image sent to a vision provider.
 * Image base64 is transport encoding rather than prompt text, but a provider
 * still charges it against the context window after visual tokenization.
 */
export const IMAGE_REQUEST_TOKEN_ALLOWANCE = 2_048

/**
 * Estimate the text context cost of messages without counting local display
 * metadata or binary image payloads. Images are delivered separately to a
 * vision-capable provider; their base64 representation must not make local
 * compaction/context estimates treat the attachment as text.
 */
export function estimateMessageTokens(messages: Message[]): number {
  const wireMessages = messages.map(({ parts: _parts, content, ...message }) => ({
    ...message,
    content: Array.isArray(content)
      ? content.map((part) => part.type === "image_url"
        ? { type: "image_url", image_url: { url: "[image payload omitted]" } }
        : part,
      )
      : content,
  }))
  return estimateTokens(JSON.stringify(wireMessages))
}

/**
 * Estimate request context for limits that must account for vision inputs.
 *
 * Keep this separate from `estimateMessageTokens`: UI context indicators and
 * textual compaction deliberately ignore binary attachments, while request
 * history trimming needs a conservative per-image allowance to avoid sending
 * too many images to a provider in one request.
 */
export function estimateMessageRequestTokens(messages: Message[]): number {
  const imageCount = messages.reduce((count, message) =>
    count + (Array.isArray(message.content)
      ? message.content.filter((part) => part.type === "image_url").length
      : 0), 0)
  return estimateMessageTokens(messages) + imageCount * IMAGE_REQUEST_TOKEN_ALLOWANCE
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
