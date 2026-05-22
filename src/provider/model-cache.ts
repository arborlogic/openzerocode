import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { ModelInfo } from "./types"

export type CachedProviderModels = {
  updatedAt: number
  models: ModelInfo[]
}

export type ModelCacheIndex = Record<string, CachedProviderModels>

function getCacheDir(): string {
  return join(process.env.HOME ?? homedir(), ".openzerocode")
}

function getCacheFile(): string {
  return join(getCacheDir(), "model-cache.json")
}

function ensureDir() {
  const dir = getCacheDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function normalizeModel(model: ModelInfo): ModelInfo {
  return {
    id: model.id,
    contextLimit: model.contextLimit,
    pricing: model.pricing,
  }
}

function normalizeIndex(input: unknown): ModelCacheIndex {
  if (!input || typeof input !== "object") return {}

  const entries = Object.entries(input as Record<string, unknown>)
  const normalized: ModelCacheIndex = {}
  for (const [providerId, value] of entries) {
    if (!value || typeof value !== "object") continue
    const record = value as { updatedAt?: unknown; models?: unknown }
    const models = Array.isArray(record.models)
      ? record.models
          .filter((item): item is ModelInfo => !!item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string")
          .map((item) => normalizeModel(item))
      : []
    if (models.length === 0) continue
    normalized[providerId] = {
      updatedAt: typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now(),
      models,
    }
  }
  return normalized
}

export function readModelCache(): ModelCacheIndex {
  try {
    const file = getCacheFile()
    if (!existsSync(file)) return {}
    return normalizeIndex(JSON.parse(readFileSync(file, "utf-8")))
  } catch {
    return {}
  }
}

function writeModelCache(index: ModelCacheIndex) {
  ensureDir()
  const target = getCacheFile()
  const tmp = target + ".tmp"
  writeFileSync(tmp, JSON.stringify(index, null, 2), "utf-8")
  renameSync(tmp, target)
}

export function getCachedModels(providerId: string): ModelInfo[] {
  return readModelCache()[providerId]?.models ?? []
}

export function getCachedModelInfo(providerId: string, modelId: string): ModelInfo | undefined {
  return getCachedModels(providerId).find((model) => model.id === modelId)
}

export function setCachedModels(providerId: string, models: ModelInfo[]): ModelInfo[] {
  const unique = Array.from(new Map(models.map((model) => [model.id, normalizeModel(model)])).values())
    .sort((a, b) => a.id.localeCompare(b.id))

  const index = readModelCache()
  if (unique.length === 0) {
    delete index[providerId]
  } else {
    index[providerId] = {
      updatedAt: Date.now(),
      models: unique,
    }
  }
  writeModelCache(index)
  return unique
}
