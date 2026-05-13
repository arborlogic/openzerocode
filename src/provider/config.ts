import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { dirname, join } from "path"
import { homedir } from "os"

export type StoredProviderConfig = {
  activeKey?: string
  keys?: Record<string, string>
  baseURL?: string
}

export type ProviderConfigFile = {
  providers?: Record<string, StoredProviderConfig>
}

const DEFAULT_CONFIG_PATH = join(homedir(), ".openzerocode", "providers.json")

export function getProviderConfigPath() {
  return process.env.OPENZEROCODE_PROVIDER_CONFIG || DEFAULT_CONFIG_PATH
}

function ensureDir(path: string) {
  mkdirSync(dirname(path), { recursive: true })
}

export function readProviderConfig(): ProviderConfigFile {
  const path = getProviderConfigPath()
  try {
    if (!existsSync(path)) return { providers: {} }
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as ProviderConfigFile
    return { providers: parsed.providers ?? {} }
  } catch {
    return { providers: {} }
  }
}

export function writeProviderConfig(config: ProviderConfigFile) {
  const path = getProviderConfigPath()
  ensureDir(path)
  writeFileSync(path, JSON.stringify({ providers: config.providers ?? {} }, null, 2) + "\n", "utf-8")
}

export function getStoredProviderConfig(providerId: string): StoredProviderConfig | undefined {
  return readProviderConfig().providers?.[providerId]
}

export function listConfiguredProviderKeys(providerId: string): string[] {
  const keys = getStoredProviderConfig(providerId)?.keys ?? {}
  return Object.keys(keys).sort((a, b) => a.localeCompare(b))
}

export function getActiveConfiguredProviderKeyName(providerId: string): string | undefined {
  const cfg = getStoredProviderConfig(providerId)
  const names = Object.keys(cfg?.keys ?? {})
  if (names.length === 0) return undefined
  if (cfg?.activeKey && cfg.keys?.[cfg.activeKey]) return cfg.activeKey
  return names.sort((a, b) => a.localeCompare(b))[0]
}

export function resolveConfiguredProviderApiKey(providerId: string): string | undefined {
  const cfg = getStoredProviderConfig(providerId)
  const active = getActiveConfiguredProviderKeyName(providerId)
  if (!cfg?.keys || !active) return undefined
  return cfg.keys[active]
}

export function resolveConfiguredProviderBaseURL(providerId: string): string | undefined {
  return getStoredProviderConfig(providerId)?.baseURL
}

export function setActiveConfiguredProviderKey(providerId: string, keyName: string): { ok: boolean; message: string } {
  const config = readProviderConfig()
  const provider = config.providers?.[providerId]
  if (!provider?.keys || !provider.keys[keyName]) {
    return { ok: false, message: `Configured key not found for ${providerId}: ${keyName}` }
  }
  config.providers ??= {}
  config.providers[providerId] = { ...provider, activeKey: keyName }
  writeProviderConfig(config)
  return { ok: true, message: `Active key for ${providerId} -> ${keyName}` }
}
