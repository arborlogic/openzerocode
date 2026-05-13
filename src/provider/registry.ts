import { Layer } from "effect"
import { type Provider } from "./types"
import { def as bigPickle } from "./big-pickle"
import { def as cloudflare } from "./cloudflare"

export type ProviderDef = {
  id: string
  name: string
  env: { apiKey: string | string[]; baseURL?: string; authOptional?: boolean }
  factory: (config: { apiKey: string; baseURL?: string; model?: string }) => Layer.Layer<Provider>
}

function resolveEnvValue(name: string | string[]): string | undefined {
  const names = Array.isArray(name) ? name : [name]
  for (const envName of names) {
    const value = process.env[envName]
    if (value) return value
  }
  return undefined
}

function resolveProviderApiKey(def: ProviderDef): string | undefined {
  return resolveEnvValue(def.env.apiKey)
}

function formatEnvNames(name: string | string[]) {
  return (Array.isArray(name) ? name : [name]).join(" or ")
}

export const PROVIDERS: Record<string, ProviderDef> = {
  openapi: bigPickle,
  cloudflare,
}

export function autoDetectProvider(): string | undefined {
  for (const [id, def] of Object.entries(PROVIDERS)) {
    if (resolveProviderApiKey(def)) return id
  }
  return undefined
}

export function buildLayer(providerId: string, model: string): Layer.Layer<Provider> {
  const def = PROVIDERS[providerId]
  if (!def) throw new Error(`Unknown provider: ${providerId}`)
  const apiKey = resolveProviderApiKey(def)
  if (!apiKey && !def.env.authOptional) {
    throw new Error(`Missing API key for provider '${providerId}'. Set ${formatEnvNames(def.env.apiKey)}.`)
  }
  const baseURL = def.env.baseURL ? process.env[def.env.baseURL] : undefined
  return def.factory({ apiKey: apiKey ?? "", baseURL, model })
}
