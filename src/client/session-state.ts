import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { Message, Part } from "../provider/types"
import { contentToText } from "../provider/content"
import { sanitizeMessages } from "./message-sanitize"

export function getSessionDir(): string {
  return join(homedir(), ".openzerocode", "sessions")
}

export function getSessionFile(): string {
  return join(getSessionDir(), "last.json")
}

function ensureSessionDir() {
  const dir = getSessionDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function saveSession(messages: Message[]) {
  ensureSessionDir()
  writeFileSync(getSessionFile(), JSON.stringify({ messages, updatedAt: Date.now() }), "utf-8")
}

export function migrateMessage(msg: Message): Message {
  if (msg.parts && msg.parts.length > 0) return msg

  if (msg.role === "assistant") {
    const parts: Part[] = []
    if (msg.reasoning_content) parts.push({ type: "reasoning", text: msg.reasoning_content })
    const text = contentToText(msg.content)
    if (text) parts.push({ type: "text", text })
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        parts.push({ type: "tool-call", id: tc.id, tool: tc.function.name ?? "unknown", input: tc.function.arguments ?? "{}" })
      }
    }
    return parts.length > 0 ? { ...msg, parts } : msg
  }

  if (msg.role === "tool") {
    return { ...msg, parts: [{ type: "tool-result", id: msg.tool_call_id, output: contentToText(msg.content) }] }
  }

  return msg
}

export function loadSession(): Message[] {
  try {
    if (!existsSync(getSessionFile())) return []
    const data = readFileSync(getSessionFile(), "utf-8")
    const raw: Message[] = JSON.parse(data).messages ?? []
    return sanitizeMessages(raw).map(migrateMessage)
  } catch {
    return []
  }
}
