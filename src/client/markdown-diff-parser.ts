export type MarkdownTable = {
  headers: string[]
  rows: string[][]
}

export type MarkdownDiffSegment =
  | { type: "markdown"; content: string }
  | { type: "diff"; content: string; file?: string }
  | { type: "table"; table: MarkdownTable; content: string }

const HUNK_HEADER_PATTERN = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/

function formatRange(start: string, count: number): string {
  return count === 1 ? start : `${start},${count}`
}

/**
 * Normalize unified diff hunk ranges so the <diff> renderer can parse patches
 * produced by LLMs even when their @@ -a,b +c,d @@ line counts are stale.
 */
export function normalizeUnifiedDiffHunks(diff: string): string {
  const lines = diff.split("\n")
  const normalized = [...lines]

  let hunkIndex = -1
  let oldStart = ""
  let newStart = ""
  let suffix = ""
  let oldCount = 0
  let newCount = 0

  function flushHunk() {
    if (hunkIndex < 0) return
    normalized[hunkIndex] = `@@ -${formatRange(oldStart, oldCount)} +${formatRange(newStart, newCount)} @@${suffix}`
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const hunk = line.match(HUNK_HEADER_PATTERN)
    if (hunk) {
      flushHunk()
      hunkIndex = i
      oldStart = hunk[1]!
      newStart = hunk[3]!
      suffix = hunk[5] ?? ""
      oldCount = 0
      newCount = 0
      continue
    }

    if (hunkIndex < 0) continue

    if (line.startsWith("@@ ")) {
      // A malformed hunk-like line: stop counting the current hunk but leave
      // the malformed line untouched rather than making the patch worse.
      flushHunk()
      hunkIndex = -1
      continue
    }

    if (line.startsWith("\\")) continue

    const marker = line[0]
    if (marker === "+") {
      newCount++
    } else if (marker === "-") {
      oldCount++
    } else {
      // Unified diff context lines normally begin with a space. Be permissive
      // for LLM output and treat blank/unmarked lines inside a hunk as context.
      oldCount++
      newCount++
    }
  }

  flushHunk()
  return normalized.join("\n")
}

function splitMarkdownTableRow(line: string): string[] {
  let trimmed = line.trim()
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1)
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1)

  const cells: string[] = []
  let current = ""
  let escaped = false

  for (const char of trimmed) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === "|") {
      cells.push(current.trim())
      current = ""
      continue
    }
    current += char
  }

  cells.push(current.trim())
  return cells
}

function isMarkdownTableSeparator(line: string, expectedCells: number): boolean {
  const cells = splitMarkdownTableRow(line)
  return cells.length === expectedCells && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
}

function looksLikeMarkdownTableRow(line: string): boolean {
  return line.includes("|") && splitMarkdownTableRow(line).length >= 2
}

function normalizeTableRow(cells: string[], length: number): string[] {
  if (cells.length === length) return cells
  if (cells.length > length) return cells.slice(0, length)
  return [...cells, ...Array.from({ length: length - cells.length }, () => "")]
}

/**
 * Parse GitHub-flavored markdown pipe tables into explicit table segments.
 * OpenTUI's markdown renderer currently leaves these tables as raw pipe text,
 * so completed assistant responses render them with a small native TUI table.
 */
export function parseMarkdownTables(content: string): MarkdownDiffSegment[] {
  const lines = content.split("\n")
  const segments: MarkdownDiffSegment[] = []
  let markdownStart = 0
  let i = 0
  let inFence = false

  function pushMarkdownUntil(lineIndex: number) {
    if (lineIndex <= markdownStart) return
    const markdown = lines.slice(markdownStart, lineIndex).join("\n")
    if (markdown) segments.push({ type: "markdown", content: markdown })
  }

  while (i < lines.length) {
    const line = lines[i]!
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      i++
      continue
    }

    if (!inFence && i + 1 < lines.length && looksLikeMarkdownTableRow(line)) {
      const headers = splitMarkdownTableRow(line)
      const separator = lines[i + 1]!
      if (isMarkdownTableSeparator(separator, headers.length)) {
        pushMarkdownUntil(i)

        const tableStart = i
        i += 2
        const rows: string[][] = []
        while (i < lines.length && looksLikeMarkdownTableRow(lines[i]!)) {
          rows.push(normalizeTableRow(splitMarkdownTableRow(lines[i]!), headers.length))
          i++
        }

        segments.push({
          type: "table",
          table: { headers, rows },
          content: lines.slice(tableStart, i).join("\n"),
        })
        markdownStart = i
        continue
      }
    }

    i++
  }

  pushMarkdownUntil(lines.length)
  return segments
}

function pushMarkdownSegments(segments: MarkdownDiffSegment[], content: string) {
  segments.push(...parseMarkdownTables(content))
}

/**
 * Check if code block content looks like a unified diff
 * (has @@ hunk headers and +/- prefixed lines).
 */
function looksLikeUnifiedDiff(code: string): boolean {
  const lines = code.split("\n")
  let hasHunkHeader = false
  let hasChangeLines = false
  for (const line of lines) {
    if (/^@@ -\d+/.test(line)) hasHunkHeader = true
    if (line.startsWith("+") || line.startsWith("-")) hasChangeLines = true
    if (hasHunkHeader && hasChangeLines) return true
  }
  return false
}

/**
 * Parse markdown content into segments: normal markdown vs ```diff/```patch blocks.
 * Also detects ```bash/```sh blocks that contain unified diff content.
 */
export function parseDiffBlocks(content: string): MarkdownDiffSegment[] {
  const segments: MarkdownDiffSegment[] = []
  // Matches fenced code blocks. Group 1: language, Group 2: filename hint, Group 3: content
  const pattern = /```(\w+)\s*(\S*)\n([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(content)) !== null) {
    const lang = match[1]!.toLowerCase()
    const filename = match[2] ?? ""
    const codeContent = match[3]!

    // Text before this code block
    const before = content.slice(lastIndex, match.index)
    if (before) {
      pushMarkdownSegments(segments, before)
    }

    // Direct diff/patch blocks always treated as diff
    const isDiffLang = lang === "diff" || lang === "patch"
    // Bash/sh blocks may contain diff output — detect by content
    const isBashWithDiff = (lang === "bash" || lang === "sh" || lang === "shell") && looksLikeUnifiedDiff(codeContent)

    if (isDiffLang || isBashWithDiff) {
      const cleanDiff = normalizeUnifiedDiffHunks(codeContent.trimEnd())
      segments.push({
        type: "diff",
        content: cleanDiff,
        file: filename || undefined,
      })
    } else {
      // Regular code block — emit as markdown
      const fenced = "```" + match[1] + (filename ? " " + filename : "") + "\n" + codeContent + "```"
      segments.push({ type: "markdown", content: fenced })
    }

    lastIndex = match.index + match[0].length
  }

  // An unclosed trailing fence remains ordinary markdown. This parser runs
  // only after streaming has finished; live output uses one native <markdown>
  // renderable so OpenTUI can update it incrementally without flicker.
  const remaining = content.slice(lastIndex)
  if (remaining) pushMarkdownSegments(segments, remaining)

  return segments
}
