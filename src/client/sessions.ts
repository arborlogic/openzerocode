import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { Message } from "../provider/types"
import type { PermissionRule } from "./permission-rules"
import { sanitizeMessages } from "./message-sanitize"

export type CompactionInfo = {
  summary: string
  createdAt: string
  sourceMessageCount: number
}

export type SessionMeta = {
  id: string
  title: string
  model: string
  provider: string
  messageCount: number
  createdAt: number
  updatedAt: number
}

type SessionIndex = {
  sessions: SessionMeta[]
  current: string | null
}

function getSessionDir(): string {
  return join(homedir(), ".openzerocode", "sessions")
}

function getIndexFile(): string {
  return join(getSessionDir(), "index.json")
}

function ensureDir() {
  const dir = getSessionDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function readIndex(): SessionIndex {
  try {
    const idxFile = getIndexFile()
    if (!existsSync(idxFile)) return { sessions: [], current: null }
    return JSON.parse(readFileSync(idxFile, "utf-8"))
  } catch {
    return { sessions: [], current: null }
  }
}

function writeIndex(index: SessionIndex) {
  ensureDir()
  writeFileSync(getIndexFile(), JSON.stringify(index, null, 2), "utf-8")
}

function sessionPath(id: string): string {
  return join(getSessionDir(), `${id}.json`)
}

export function generateId(): string {
  return "ses_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function defaultSessionTitle(time = Date.now()): string {
  const d = new Date(time)
  return `New Session - ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

export function listSessions(): SessionMeta[] {
  return readIndex().sessions.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getCurrentSessionId(): string | null {
  return readIndex().current
}

export function setCurrentSessionId(id: string | null) {
  const index = readIndex()
  index.current = id
  writeIndex(index)
}

export function createSession(model: string, provider: string, messages?: Message[]): SessionMeta {
  const id = generateId()
  const now = Date.now()
  const meta: SessionMeta = {
    id,
    title: defaultSessionTitle(now),
    model,
    provider,
    messageCount: messages?.length ?? 0,
    createdAt: now,
    updatedAt: now,
  }
  const index = readIndex()
  index.sessions.push(meta)
  index.current = id
  writeIndex(index)

  if (messages && messages.length > 0) {
    writeFileSync(sessionPath(id), JSON.stringify({
      messages,
      model,
      provider,
      createdAt: now,
      updatedAt: now,
    }, null, 2), "utf-8")
  }

  return meta
}

export function saveSession(
  id: string,
  messages: Message[],
  model: string,
  provider: string,
  mode?: string,
  compaction?: CompactionInfo,
  permissionRules?: PermissionRule[],
  autoApprove?: boolean,
) {
  ensureDir()
  const now = Date.now()
  const index = readIndex()
  const existing = index.sessions.find(s => s.id === id)
  const createdAt = existing?.createdAt ?? now
  const sanitized = sanitizeMessages(messages)

  writeFileSync(sessionPath(id), JSON.stringify({
    messages: sanitized,
    model,
    provider,
    mode,
    compaction,
    permissionRules: permissionRules ?? [],
    autoApprove: autoApprove ?? false,
    createdAt,
    updatedAt: now,
  }, null, 2), "utf-8")

  const count = sanitized.length
  if (existing) {
    existing.messageCount = count
    existing.model = model
    existing.provider = provider
    existing.updatedAt = now
  } else {
    index.sessions.push({
      id,
      title: defaultSessionTitle(createdAt),
      model,
      provider,
      messageCount: count,
      createdAt,
      updatedAt: now,
    })
  }
  index.current = id
  writeIndex(index)
}

export function loadSession(id: string): Message[] | null {
  try {
    const path = sessionPath(id)
    if (!existsSync(path)) return null
    const data = JSON.parse(readFileSync(path, "utf-8"))
    return data.messages ?? null
  } catch {
    return null
  }
}

export function loadSessionState(id: string): { messages: Message[]; model?: string; provider?: string; mode?: string; compaction?: CompactionInfo; permissionRules?: PermissionRule[]; autoApprove?: boolean } | null {
  try {
    const path = sessionPath(id)
    if (!existsSync(path)) return null
    const data = JSON.parse(readFileSync(path, "utf-8"))
    return {
      messages: sanitizeMessages(data.messages ?? []),
      model: data.model,
      provider: data.provider,
      mode: data.mode,
      compaction: data.compaction,
      permissionRules: data.permissionRules ?? [],
      autoApprove: data.autoApprove ?? false,
    }
  } catch {
    return null
  }
}

export function deleteSession(id: string): boolean {
  let removed = false

  const path = sessionPath(id)
  if (existsSync(path)) {
    unlinkSync(path)
    removed = true
  }

  const index = readIndex()
  const filtered = index.sessions.filter(s => s.id !== id)
  if (filtered.length < index.sessions.length) {
    index.sessions = filtered
    if (index.current === id) {
      index.current = filtered.length > 0 ? filtered[0]!.id : null
    }
    writeIndex(index)
    removed = true
  }

  // Clean up activity marker if any
  unmarkSessionActive(id)

  return removed
}

export function currentSessionMeta(): SessionMeta | null {
  const index = readIndex()
  if (!index.current) return null
  return index.sessions.find(s => s.id === index.current) ?? null
}

export function updateSessionMeta(id: string, updates: Partial<Pick<SessionMeta, "title">>) {
  const index = readIndex()
  const meta = index.sessions.find(s => s.id === id)
  if (!meta) return
  Object.assign(meta, updates)
  writeIndex(index)
}

// ─── Lightweight active marker ──────────────────────────────────────────

const ACTIVITY_DIR = join(homedir(), ".openzerocode", ".active")

function ensureActivityDir() {
  if (!existsSync(ACTIVITY_DIR)) mkdirSync(ACTIVITY_DIR, { recursive: true })
}

function activeMarkerPath(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9._:-]/g, "_")
  return join(ACTIVITY_DIR, safe)
}

/** Mark a session as actively being processed by this process. */
export function markSessionActive(id: string) {
  ensureActivityDir()
  writeFileSync(activeMarkerPath(id), JSON.stringify({
    pid: process.pid,
    timestamp: Date.now(),
  }), "utf-8")
}

/** Remove the active marker for a session. */
export function unmarkSessionActive(id: string) {
  const path = activeMarkerPath(id)
  if (existsSync(path)) unlinkSync(path)
}

/**
 * Check if a session has a recent active marker (written within the last 30s).
 * Does NOT check PID — it's just a hint that *some* process recently touched it.
 */
export function isSessionActive(id: string): boolean {
  const path = activeMarkerPath(id)
  if (!existsSync(path)) return false
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"))
    return Date.now() - (data.timestamp ?? 0) < 30_000
  } catch {
    return false
  }
}

/**
 * Get active marker info for display. Returns null if no recent marker.
 */
export function getSessionActiveInfo(id: string): { pid: number; timestamp: number } | null {
  const path = activeMarkerPath(id)
  if (!existsSync(path)) return null
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"))
    if (Date.now() - (data.timestamp ?? 0) >= 30_000) return null
    return { pid: data.pid ?? 0, timestamp: data.timestamp ?? 0 }
  } catch {
    return null
  }
}
