import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { Message, Part } from "../provider/types"
import { sanitizeMessages } from "./message-sanitize"

export const SESSION_DIR = join(homedir(), ".openzerocode", "sessions")
export const SESSION_FILE = join(SESSION_DIR, "last.json")

function ensureSessionDir() {
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true })
}

export function saveSession(messages: Message[]) {
  ensureSessionDir()
  writeFileSync(SESSION_FILE, JSON.stringify({ messages, updatedAt: Date.now() }), "utf-8")
}

function migrateMessage(msg: Message): Message {
  if (msg.parts && msg.parts.length > 0) return msg

  if (msg.role === "assistant") {
    const parts: Part[] = []
    if (msg.reasoning_content) parts.push({ type: "reasoning", text: msg.reasoning_content })
    if (msg.content) parts.push({ type: "text", text: msg.content })
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        parts.push({ type: "tool-call", id: tc.id, tool: tc.function.name ?? "unknown", input: tc.function.arguments ?? "{}" })
      }
    }
    return parts.length > 0 ? { ...msg, parts } : msg
  }

  if (msg.role === "tool") {
    return { ...msg, parts: [{ type: "tool-result", id: msg.tool_call_id, output: msg.content ?? "" }] }
  }

  return msg
}

export function loadSession(): Message[] {
  try {
    if (!existsSync(SESSION_FILE)) return []
    const data = readFileSync(SESSION_FILE, "utf-8")
    const raw: Message[] = JSON.parse(data).messages ?? []
    return sanitizeMessages(raw).map(migrateMessage)
  } catch {
    return []
  }
}
