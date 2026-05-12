import { Layer } from "effect"
import { type Provider } from "./types"
import { def as bigPickle } from "./big-pickle"

export type ProviderDef = {
  id: string
  name: string
  env: { apiKey: string; baseURL?: string }
  factory: (config: { apiKey: string; baseURL?: string; model?: string }) => Layer.Layer<Provider>
}

export const PROVIDERS: Record<string, ProviderDef> = {
  "big-pickle": bigPickle,
}

export function autoDetectProvider(): string | undefined {
  for (const [id, def] of Object.entries(PROVIDERS)) {
    if (process.env[def.env.apiKey]) return id
  }
  return "big-pickle"
}

export function buildLayer(providerId: string, model: string): Layer.Layer<Provider> {
  const def = PROVIDERS[providerId]
  if (!def) throw new Error(`Unknown provider: ${providerId}`)
  const apiKey = process.env[def.env.apiKey] ?? ""
  const baseURL = def.env.baseURL ? process.env[def.env.baseURL] : undefined
  return def.factory({ apiKey, baseURL, model })
}
