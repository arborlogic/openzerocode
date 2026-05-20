import { Layer } from "effect"
import { type Provider } from "./types"
import { def as bigPickle } from "./big-pickle"
import { def as openai } from "./openai"
import { def as openaiCodex } from "./openai-codex"
import { def as openrouter } from "./openrouter"
import { def as zeroApi } from "./zero-api"
import { resolveConfiguredProviderApiKey, resolveConfiguredProviderBaseURL } from "./config"

export type ProviderDef = {
  id: string
  name: string
  defaultModel?: string
  authOptional?: boolean
  envKeys?: string[]
  detectAuth?: () => boolean
  factory: (config: { apiKey: string; baseURL?: string; model?: string }) => Layer.Layer<Provider>
}

export const PROVIDERS: Record<string, ProviderDef> = {
  "opencode-zen": bigPickle,
  openai,
  "openai-codex": openaiCodex,
  openrouter,
  "zero-api": zeroApi,
}

export function resolveProviderApiKey(providerId: string): string | undefined {
  const configured = resolveConfiguredProviderApiKey(providerId)
  if (configured) return configured

  const envKeys = PROVIDERS[providerId]?.envKeys ?? []
  for (const key of envKeys) {
    const value = process.env[key]
    if (value) return value
  }
  return undefined
}

export function autoDetectProvider(): string | undefined {
  for (const id of Object.keys(PROVIDERS)) {
    const provider = PROVIDERS[id]
    if (resolveProviderApiKey(id) || provider?.detectAuth?.()) return id
  }
  return undefined
}

export function defaultModelForProvider(providerId: string): string {
  return PROVIDERS[providerId]?.defaultModel ?? "big-pickle"
}

export function buildLayer(providerId: string, model: string): Layer.Layer<Provider> {
  const def = PROVIDERS[providerId]
  if (!def) throw new Error(`Unknown provider: ${providerId}`)
  const apiKey = resolveProviderApiKey(providerId)
  if (!apiKey && !def.authOptional) {
    const envHint = def.envKeys?.length ? ` or set ${def.envKeys.join(" / ")}` : ""
    throw new Error(`Missing API key for provider '${providerId}'. Configure ${providerId} in ${process.env.OPENZEROCODE_PROVIDER_CONFIG || "~/.openzerocode/providers.json"}${envHint}.`)
  }
  const baseURL = resolveConfiguredProviderBaseURL(providerId)
  return def.factory({ apiKey: apiKey ?? "", baseURL, model })
}
