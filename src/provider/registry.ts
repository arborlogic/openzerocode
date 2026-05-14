import { Layer } from "effect"
import { type Provider } from "./types"
import { def as bigPickle } from "./big-pickle"
import { def as openrouter } from "./openrouter"
import { resolveConfiguredProviderApiKey, resolveConfiguredProviderBaseURL } from "./config"

export type ProviderDef = {
  id: string
  name: string
  defaultModel?: string
  authOptional?: boolean
  factory: (config: { apiKey: string; baseURL?: string; model?: string }) => Layer.Layer<Provider>
}

export const PROVIDERS: Record<string, ProviderDef> = {
  "opencode-zen": bigPickle,
  openrouter,
}

export function autoDetectProvider(): string | undefined {
  for (const id of Object.keys(PROVIDERS)) {
    if (resolveConfiguredProviderApiKey(id)) return id
  }
  return undefined
}

export function defaultModelForProvider(providerId: string): string {
  return PROVIDERS[providerId]?.defaultModel ?? "big-pickle"
}

export function buildLayer(providerId: string, model: string): Layer.Layer<Provider> {
  const def = PROVIDERS[providerId]
  if (!def) throw new Error(`Unknown provider: ${providerId}`)
  const apiKey = resolveConfiguredProviderApiKey(providerId)
  if (!apiKey && !def.authOptional) {
    throw new Error(`Missing API key for provider '${providerId}'. Configure ${providerId} in ${process.env.OPENZEROCODE_PROVIDER_CONFIG || "~/.openzerocode/providers.json"}.`)
  }
  const baseURL = resolveConfiguredProviderBaseURL(providerId)
  return def.factory({ apiKey: apiKey ?? "", baseURL, model })
}
