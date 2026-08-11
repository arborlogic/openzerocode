import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

export type UsageEntry = {
  timestamp: number
  provider: string
  keyName: string
  model: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  sessionId?: string
}

export type AggregatedUsage = {
  provider: string
  keyName: string
  model: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  totalTokens: number
  requestCount: number
}

export type DailyBucket = {
  date: string
  items: AggregatedUsage[]
  totalTokens: number
}

export type HourlyBucket = {
  hour: string
  items: AggregatedUsage[]
  totalTokens: number
}

function getDataDir(): string {
  return join(homedir(), ".openzerocode")
}

function getUsageFile(): string {
  return join(getDataDir(), "usage.jsonl")
}

function ensureDir() {
  const dir = getDataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function appendUsageEntry(entry: UsageEntry) {
  try {
    ensureDir()
    appendFileSync(getUsageFile(), JSON.stringify(entry) + "\n", "utf-8")
  } catch {
    // Silently ignore write errors
  }
}

export function loadUsageEntries(): UsageEntry[] {
  try {
    const path = getUsageFile()
    if (!existsSync(path)) return []
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean)
    return lines.flatMap((line) => {
      try {
        return [JSON.parse(line) as UsageEntry]
      } catch {
        return []
      }
    })
  } catch {
    return []
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

export function dateLabel(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

export function hourLabel(ts: number): string {
  const d = new Date(ts)
  return `${dateLabel(ts)} ${pad2(d.getHours())}:00`
}

export function aggregateEntries(entries: UsageEntry[]): AggregatedUsage[] {
  const map = new Map<string, AggregatedUsage>()
  for (const e of entries) {
    const key = `${e.provider}\0${e.keyName}\0${e.model}`
    const agg = map.get(key)
    if (agg) {
      agg.inputTokens += e.inputTokens
      agg.outputTokens += e.outputTokens
      agg.cachedInputTokens += e.cachedInputTokens ?? 0
      agg.totalTokens += e.inputTokens + e.outputTokens
      agg.requestCount++
    } else {
      map.set(key, {
        provider: e.provider,
        keyName: e.keyName,
        model: e.model,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
        cachedInputTokens: e.cachedInputTokens ?? 0,
        totalTokens: e.inputTokens + e.outputTokens,
        requestCount: 1,
      })
    }
  }
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens)
}

export function getDailyBuckets(entries: UsageEntry[], days = 14): DailyBucket[] {
  const now = Date.now()
  const cutoff = now - days * 24 * 60 * 60 * 1000
  const filtered = entries.filter((e) => e.timestamp >= cutoff)

  const byDate = new Map<string, UsageEntry[]>()
  for (const e of filtered) {
    const label = dateLabel(e.timestamp)
    const bucket = byDate.get(label) ?? []
    bucket.push(e)
    byDate.set(label, bucket)
  }

  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, es]) => {
      const items = aggregateEntries(es)
      return {
        date,
        items,
        totalTokens: items.reduce((s, i) => s + i.totalTokens, 0),
      }
    })
}

export function getHourlyBuckets(entries: UsageEntry[], hours = 48): HourlyBucket[] {
  const now = Date.now()
  const cutoff = now - hours * 60 * 60 * 1000
  const filtered = entries.filter((e) => e.timestamp >= cutoff)

  const byHour = new Map<string, UsageEntry[]>()
  for (const e of filtered) {
    const label = hourLabel(e.timestamp)
    const bucket = byHour.get(label) ?? []
    bucket.push(e)
    byHour.set(label, bucket)
  }

  return [...byHour.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([hour, es]) => {
      const items = aggregateEntries(es)
      return {
        hour,
        items,
        totalTokens: items.reduce((s, i) => s + i.totalTokens, 0),
      }
    })
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1000) return (n / 1000).toFixed(1) + "k"
  return String(n)
}

export type SessionRequestRow = {
  timestamp: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
}

export type SessionBreakdown = {
  sessionId: string
  provider: string
  keyName: string
  model: string
  totalInputTokens: number
  totalOutputTokens: number
  totalCachedInputTokens: number
  totalRequests: number
  recentEntries: SessionRequestRow[]
  lastActivity: number
}

export function getSessionBreakdown(
  entries: UsageEntry[],
  recentCount = 5,
  maxSessions = Number.POSITIVE_INFINITY,
): SessionBreakdown[] {
  const safeRecentCount = Math.max(0, Math.floor(recentCount))
  const safeMaxSessions = Math.max(0, Math.floor(maxSessions))
  const map = new Map<string, {
    provider: string
    keyName: string
    model: string
    totalInputTokens: number
    totalOutputTokens: number
    totalCachedInputTokens: number
    totalRequests: number
    recentEntries: SessionRequestRow[]
    lastActivity: number
  }>()

  for (const e of entries) {
    const sid = e.sessionId ?? "(no session)"
    const request = {
      timestamp: e.timestamp,
      inputTokens: e.inputTokens,
      outputTokens: e.outputTokens,
      cachedInputTokens: e.cachedInputTokens ?? 0,
    }
    const existing = map.get(sid)
    if (existing) {
      existing.totalInputTokens += e.inputTokens
      existing.totalOutputTokens += e.outputTokens
      existing.totalCachedInputTokens += e.cachedInputTokens ?? 0
      existing.totalRequests++
      existing.recentEntries.push(request)
      existing.recentEntries.sort((a, b) => b.timestamp - a.timestamp)
      if (existing.recentEntries.length > safeRecentCount) existing.recentEntries.pop()
      if (e.timestamp > existing.lastActivity) {
        existing.lastActivity = e.timestamp
        existing.model = e.model
        existing.provider = e.provider
        existing.keyName = e.keyName
      }
    } else {
      map.set(sid, {
        provider: e.provider,
        keyName: e.keyName,
        model: e.model,
        totalInputTokens: e.inputTokens,
        totalOutputTokens: e.outputTokens,
        totalCachedInputTokens: e.cachedInputTokens ?? 0,
        totalRequests: 1,
        recentEntries: safeRecentCount > 0 ? [request] : [],
        lastActivity: e.timestamp,
      })
    }
  }

  return [...map.entries()]
    .sort((a, b) => b[1].lastActivity - a[1].lastActivity)
    .slice(0, safeMaxSessions)
    .map(([sessionId, data]) => ({
      sessionId,
      provider: data.provider,
      keyName: data.keyName,
      model: data.model,
      totalInputTokens: data.totalInputTokens,
      totalOutputTokens: data.totalOutputTokens,
      totalCachedInputTokens: data.totalCachedInputTokens,
      totalRequests: data.totalRequests,
      recentEntries: data.recentEntries,
      lastActivity: data.lastActivity,
    }))
}
