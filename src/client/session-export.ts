import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Message } from "../provider/types"
import type { CompactionInfo } from "./sessions"

export type CompactTranscriptExport = {
  sessionId: string
  title?: string
  createdAt?: Date
  compaction?: CompactionInfo
  messages: Message[]
}

function textFromMessage(msg: Message): string {
  const partText = msg.parts
    ?.filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim()

  return (partText || msg.content || "").trim()
}

function mdSection(title: string, body: string): string {
  return [`### ${title}`, "", body.trim()].join("\n")
}

export function buildCompactTranscriptExport(input: CompactTranscriptExport): string {
  const lines: string[] = ["# OpenZeroCode Session Export", ""]

  if (input.title) lines.push(`Session: ${input.title}`, "")
  lines.push(`Session ID: ${input.sessionId}`)
  lines.push(`Exported At: ${(input.createdAt ?? new Date()).toISOString()}`, "")

  if (input.compaction?.summary?.trim()) {
    lines.push("## Compact Summary", "")
    lines.push(input.compaction.summary.trim(), "")
  }

  lines.push("## Conversation", "")

  let count = 0
  for (const msg of input.messages) {
    if (msg.role !== "user" && msg.role !== "assistant") continue
    const text = textFromMessage(msg)
    if (!text) continue
    lines.push(mdSection(msg.role === "user" ? "User" : "AI", text), "")
    count++
  }

  if (count === 0) lines.push("(No user ask or AI response content.)", "")

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n"
}

function safeFilenamePart(value: string): string {
  return value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "session"
}

export function writeCompactTranscriptExport(input: CompactTranscriptExport, directory = process.cwd()): string {
  const exportDir = join(directory, "openzerocode-exports")
  mkdirSync(exportDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const filename = `${stamp}-${safeFilenamePart(input.title ?? input.sessionId)}-compact.md`
  const path = join(exportDir, filename)
  writeFileSync(path, buildCompactTranscriptExport(input), "utf-8")
  return path
}
