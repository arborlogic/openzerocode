import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export type RunOutcome = "success" | "fail"

export interface RunToolEvent {
  name: string
  input?: string
  output?: string
  error?: boolean
}

export interface RunRecord {
  skillName: string
  skillDir: string
  prompt: string
  matchedBy?: string
  pageUrl?: string
  model?: string
  provider?: string
  tools: RunToolEvent[]
  finalText: string
  outcome: RunOutcome
  errorMessage?: string
  startedAt: Date
  endedAt: Date
}

function fence(body: string): string {
  return ["```", body.trim(), "```"].join("\n")
}

export function buildRunRecord(rec: RunRecord): string {
  const lines: string[] = []
  lines.push(`# Run: ${rec.skillName} — ${rec.outcome}`)
  lines.push("")
  lines.push(`- Outcome: **${rec.outcome}**`)
  lines.push(`- Started: ${rec.startedAt.toISOString()}`)
  lines.push(`- Ended: ${rec.endedAt.toISOString()}`)
  if (rec.pageUrl) lines.push(`- Page URL: ${rec.pageUrl}`)
  if (rec.matchedBy) lines.push(`- Matched by: ${rec.matchedBy}`)
  if (rec.model) lines.push(`- Model: ${rec.model}${rec.provider ? ` (${rec.provider})` : ""}`)
  if (rec.errorMessage) lines.push(`- Error: ${rec.errorMessage}`)
  lines.push("")

  lines.push("## Task")
  lines.push("")
  lines.push(fence(rec.prompt))
  lines.push("")

  lines.push("## Trajectory")
  lines.push("")
  if (rec.tools.length === 0) {
    lines.push("(no tool calls)")
  } else {
    let i = 1
    for (const t of rec.tools) {
      const tag = t.error ? "ERROR" : "ok"
      lines.push(`### ${i}. ${t.name} [${tag}]`)
      lines.push("")
      if (t.input) {
        lines.push("Input:")
        lines.push(fence(t.input))
      }
      if (t.output) {
        lines.push("Output:")
        lines.push(fence(t.output))
      }
      lines.push("")
      i++
    }
  }

  lines.push("## Final Output")
  lines.push("")
  lines.push(rec.finalText.trim() || "(empty)")
  lines.push("")

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n"
}

/** Write a run record to skills/<skill>/runs/<timestamp>-<outcome>.md. Returns the path. */
export function writeRunRecord(rec: RunRecord): string {
  const runsDir = join(rec.skillDir, "runs")
  mkdirSync(runsDir, { recursive: true })
  const stamp = rec.startedAt.toISOString().replace(/[:.]/g, "-")
  const path = join(runsDir, `${stamp}-${rec.outcome}.md`)
  writeFileSync(path, buildRunRecord(rec), "utf-8")
  return path
}
