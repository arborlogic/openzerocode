import { writeFileSync } from "fs"
import type { Message } from "../provider/types"
import { buildCompactionTranscript, stripCompactSummaryMessages } from "./session-compact"
import { resolveWorkspaceWritePaths } from "./workspace-memory"

const SUMMARY_HEADING = "# SESSION_SUMMARY.md"

export function buildSessionSummaryPrompt(messages: Message[]) {
  const transcript = buildCompactionTranscript(stripCompactSummaryMessages(messages))
  const system = [
    "You are writing SESSION_SUMMARY.md for a coding workspace handoff.",
    "Use only the provided transcript.",
    "Return markdown with the exact section headings requested.",
    "Use concise bullet points.",
    "Keep every section, even when sparse.",
    "Prefer concrete file paths, commands, errors, and remaining work.",
    "For Relevant Files, use bullets in the format: - path: why it matters.",
    "Only include files, directories, or commands that clearly affect continuation.",
    "For Critical Context, keep only repo-specific constraints, important errors, gotchas, or corrections that would prevent rework.",
    "Do not put routine verification steps, ordinary completed actions, or generic commands into Critical Context unless they represent a non-obvious repo requirement.",
    "For Next Steps, list short action-oriented bullets in likely execution order.",
    "Do not repeat the same fact across multiple sections unless it changes what the next agent should do.",
    "If a section has no meaningful content, write a single bullet: - None.",
    "Do not use code fences.",
    "Do not invent facts.",
  ].join("\n")

  const user = [
    "Write a fresh SESSION_SUMMARY.md with these exact sections:",
    SUMMARY_HEADING,
    "## Goal",
    "## Done",
    "## In Progress",
    "## Blocked",
    "## Key Decisions",
    "## Next Steps",
    "## Critical Context",
    "## Relevant Files",
    "",
    "Summarize this session transcript:",
    "",
    transcript,
  ].join("\n")

  return { system, user }
}

export function normalizeSessionSummary(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ""
  return trimmed.startsWith(SUMMARY_HEADING)
    ? trimmed
    : `${SUMMARY_HEADING}\n\n${trimmed}`
}

export function writeSessionSummary(summary: string, startDir = process.cwd()) {
  const normalized = normalizeSessionSummary(summary)
  if (!normalized) return undefined
  const { sessionSummaryPath } = resolveWorkspaceWritePaths(startDir)
  writeFileSync(sessionSummaryPath, `${normalized}\n`, "utf-8")
  return sessionSummaryPath
}
