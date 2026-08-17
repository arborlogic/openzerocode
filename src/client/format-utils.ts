import type { CompactionInfo } from "./sessions"
import type { ModelInfo } from "../provider/types"
export { contentToText } from "../provider/content"
import { getEffectiveContextLimit, getKnownModelConfig, getModelConfig } from "../provider/models"

// File extension → tree-sitter filetype mapping
const LANGUAGE_EXTENSIONS: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".c++": "cpp",
  ".c": "c",
  ".h": "c",
  ".cs": "csharp",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".rb": "ruby",
  ".php": "php",
  ".scala": "scala",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "css",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".lua": "lua",
  ".hs": "haskell",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".sql": "sql",
  ".xml": "html",
  ".md": "markdown",
  ".markdown": "markdown",
  ".swift": "swift",
  ".zig": "zig",
  ".vue": "html",
  ".svelte": "html",
  ".hcl": "bash",
  ".tf": "bash",
  ".nix": "bash",
  ".ex": "ruby",
  ".exs": "ruby",
  ".erl": "ruby",
  ".r": "python",
  ".R": "python",
}

export function detectFiletype(filePath: string): string {
  const ext = filePath.match(/\.[^.]*$/)?.[0]?.toLowerCase()
  if (!ext) return "none"
  return LANGUAGE_EXTENSIONS[ext] ?? "none"
}

export function formatQueueStatus(status: string, depth: number) {
  return depth > 0 ? `${status} • ${depth} queued` : status
}

export function summaryPreview(summary: string, maxLen = 80): string {
  const collapsed = summary.replace(/\s+/g, " ").trim()
  if (collapsed.length <= maxLen) return collapsed
  return collapsed.slice(0, maxLen).trimEnd() + "…"
}

export function formatCompactionMarker(info: CompactionInfo): string {
  const count = info.sourceMessageCount === 1 ? "1 earlier message" : `${info.sourceMessageCount} earlier messages`
  const createdAt = new Date(info.createdAt)
  const when = Number.isNaN(createdAt.getTime())
    ? ""
    : ` · ${createdAt.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
  const preview = info.summary ? ` · "${summaryPreview(info.summary)}"` : ""
  return `↯ Session compacted · ${count} summarized${when}${preview}`
}

export function normalizeDiffHunkCounts(diff: string): string {
  if (!diff) return diff
  const lines = diff.split("\n")
  const hunkRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const m = hunkRe.exec(line)
    if (!m) {
      out.push(line)
      i++
      continue
    }
    const oldStart = m[1]
    const newStart = m[3]
    const trailing = m[5] ?? ""
    let oldCount = 0
    let newCount = 0
    const body: string[] = []
    let j = i + 1
    while (j < lines.length) {
      const l = lines[j]!
      if (hunkRe.test(l)) break
      if (l.startsWith("diff --git ") || l.startsWith("--- ") || l.startsWith("+++ ") || l.startsWith("Index: ")) break
      const op = l[0]
      if (op === "-") oldCount++
      else if (op === "+") newCount++
      else if (op === " ") { oldCount++; newCount++ }
      else if (op === "\\") { /* "\ No newline at end of file" — skip count */ }
      else if (l.length === 0) {
        if (j === lines.length - 1) break
        oldCount++
        newCount++
      } else {
        break
      }
      body.push(l)
      j++
    }
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${trailing}`)
    for (const b of body) out.push(b)
    i = j
  }
  return out.join("\n")
}

export function tryParseJSON(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) } catch { /* fall through */ }
  // Handle concatenated JSON objects: {"a":1}{"b":2} (a common model mistake)
  // Fix by wrapping as array, then merging — duplicate keys become arrays.
  try {
    const fixed = "[" + raw.trim().replace(/\}\s*\{/g, "},{") + "]"
    const arr = JSON.parse(fixed)
    if (!Array.isArray(arr)) return {}
    const merged: Record<string, unknown> = {}
    for (const obj of arr) {
      if (!obj || typeof obj !== "object") continue
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (k in merged) {
          if (!Array.isArray(merged[k])) merged[k] = [merged[k]]
          ;(merged[k] as unknown[]).push(v)
        } else {
          merged[k] = v
        }
      }
    }
    return merged
  } catch { return {} }
}

export function formatToolCallInput(tool: string, input: string): string {
  const parsed = tryParseJSON(input)
  if (tool === "bash" && typeof parsed.command === "string") {
    return `$ ${parsed.command}`
  }
  if (tool === "read_file" && typeof parsed.filePath === "string") {
    return parsed.filePath
  }
  if (tool === "write" && typeof parsed.filePath === "string") {
    const contentLen = typeof parsed.content === "string" ? parsed.content.length : 0
    return `${parsed.filePath}  (${contentLen} chars)`
  }
  if (tool === "glob" && typeof parsed.pattern === "string") {
    return parsed.pattern
  }
  if (tool === "web_fetch" && typeof parsed.url === "string") {
    return parsed.url
  }
  const firstLine = input.split("\n")[0] ?? ""
  return firstLine.length > 80 ? firstLine.slice(0, 77) + "…" : firstLine
}

export function formatToolResultPreview(text: string): string {
  const lines = text.split("\n")
  if (lines.length === 0) return ""
  if (lines.length === 1 && lines[0]!.length <= 120) return lines[0]!
  const firstLine = lines[0]!
  const preview = firstLine.length > 100 ? firstLine.slice(0, 97) + "…" : firstLine
  return `${preview}  (${lines.length} lines)`
}

export function stripAnsi(str: string) {
  return str.replace(/\x1b\[[0-9;]*m/g, "")
}

export function truncateText(text: string, max: number) {
  if (max <= 0) return ""
  if (text.length <= max) return text
  if (max <= 1) return "…"
  return text.slice(0, max - 1) + "…"
}

export function fmtContextLimit(limit: number) {
  if (limit >= 1_000_000) {
    const millions = limit / 1_000_000
    return `${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)}m`
  }
  return `${Math.round(limit / 1000)}k`
}

export function fmtPrice(value: number) {
  if (value === 0) return "free"
  if (value >= 1) return `$${value}`
  return `$${value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}`
}

export function modelHint(model: string, fallback?: ModelInfo) {
  const cfg = getKnownModelConfig(model) ?? (fallback?.contextLimit ? getModelConfig(model, fallback) : undefined)
  if (!cfg) return ""
  const contextLimit = getEffectiveContextLimit(model, fallback)
  if (!cfg.pricing) return fmtContextLimit(contextLimit)
  if (cfg.pricing.input === 0 && cfg.pricing.output === 0) return `${fmtContextLimit(contextLimit)} • free`
  return `${fmtContextLimit(contextLimit)} • ${fmtPrice(cfg.pricing.input)}/${fmtPrice(cfg.pricing.output)}`
}

export function isTransientPasteMarker(input: string) {
  return /^\[Pasted ~\d+ lines(?: #\d+)?\]/.test(input.trim())
}

export function maskKey(value: string): string {
  if (value.length <= 8) return value.slice(0, 1) + "***" + value.slice(-1)
  const prefix = value.slice(0, 5)
  const suffix = value.slice(-3)
  return `${prefix}***${suffix}`
}
