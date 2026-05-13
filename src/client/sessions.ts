import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { Message } from "../provider/types"
import type { PermissionRule } from "./permission-rules"

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

const SESSION_DIR = join(homedir(), ".openzerocode", "sessions")
const INDEX_FILE = join(SESSION_DIR, "index.json")

function ensureDir() {
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true })
}

function readIndex(): SessionIndex {
  try {
    if (!existsSync(INDEX_FILE)) return { sessions: [], current: null }
    return JSON.parse(readFileSync(INDEX_FILE, "utf-8"))
  } catch {
    return { sessions: [], current: null }
  }
}

function writeIndex(index: SessionIndex) {
  ensureDir()
  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), "utf-8")
}

function sessionPath(id: string): string {
  return join(SESSION_DIR, `${id}.json`)
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
) {
  ensureDir()
  const now = Date.now()
  const index = readIndex()
  const existing = index.sessions.find(s => s.id === id)
  const createdAt = existing?.createdAt ?? now

  writeFileSync(sessionPath(id), JSON.stringify({
    messages,
    model,
    provider,
    mode,
    compaction,
    permissionRules: permissionRules ?? [],
    createdAt,
    updatedAt: now,
  }, null, 2), "utf-8")

  const count = messages.length
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

export function loadSessionState(id: string): { messages: Message[]; model?: string; provider?: string; mode?: string; compaction?: CompactionInfo; permissionRules?: PermissionRule[] } | null {
  try {
    const path = sessionPath(id)
    if (!existsSync(path)) return null
    const data = JSON.parse(readFileSync(path, "utf-8"))
    return {
      messages: data.messages ?? [],
      model: data.model,
      provider: data.provider,
      mode: data.mode,
      compaction: data.compaction,
      permissionRules: data.permissionRules ?? [],
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
