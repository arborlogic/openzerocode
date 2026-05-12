import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { Message } from "../provider/types"

export const SESSION_DIR = join(homedir(), ".openzerocode", "sessions")
export const SESSION_FILE = join(SESSION_DIR, "last.json")

function ensureSessionDir() {
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true })
}

export function saveSession(messages: Message[]) {
  ensureSessionDir()
  writeFileSync(SESSION_FILE, JSON.stringify({ messages, updatedAt: Date.now() }), "utf-8")
}

export function sanitizeMessages(messages: Message[]): Message[] {
  const out: Message[] = []
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]
    if (msg?.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      const requiredIds = new Set(msg.tool_calls.map((tc) => tc.id))
      const toolMsgs: Message[] = []
      let j = i + 1
      while (j < messages.length && messages[j]?.role === "tool") {
        toolMsgs.push(messages[j]!)
        j++
      }
      const foundIds = new Set(toolMsgs.map((m) => m.tool_call_id).filter(Boolean))
      if ([...requiredIds].every((id) => foundIds.has(id))) {
        out.push(msg)
        for (const tm of toolMsgs) out.push(tm)
      }
      i = j
      continue
    }
    if (msg) out.push(msg)
    i++
  }
  return out
}

export function loadSession(): Message[] {
  try {
    if (!existsSync(SESSION_FILE)) return []
    const data = readFileSync(SESSION_FILE, "utf-8")
    const raw: Message[] = JSON.parse(data).messages ?? []
    return sanitizeMessages(raw)
  } catch {
    return []
  }
}
