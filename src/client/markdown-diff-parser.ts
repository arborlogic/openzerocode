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
 * Parse markdown content into segments: normal markdown vs ```diff/```patch blocks.
 */
export function parseDiffBlocks(content: string, streaming = false): MarkdownDiffSegment[] {
  const segments: MarkdownDiffSegment[] = []
  // Matches fenced code blocks with diff or patch language.
  // Group 1: language (diff/patch)
  // Group 2: optional filename hint on the same line
  // Group 3: the content inside the block
  const pattern = /```(diff|patch)\s*(\S*)\n([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(content)) !== null) {
    // Text before this diff block
    const before = content.slice(lastIndex, match.index)
    if (before) {
      pushMarkdownSegments(segments, before)
    }

    const filename = match[2] ?? ""
    const diffContent = match[3]!

    // Strip the leading/trailing diff header lines if present but keep the hunk
    // The <diff> component expects unified diff format starting from ---/+++
    const cleanDiff = normalizeUnifiedDiffHunks(diffContent.trimEnd())

    // If the block has a leading diff --git line, keep it; otherwise
    // the parser handles plain unified diff just fine.
    segments.push({
      type: "diff",
      content: cleanDiff,
      file: filename || undefined,
    })

    lastIndex = match.index + match[0].length
  }

  // Remaining text after last diff block. While streaming, treat an unclosed
  // trailing diff/patch fence as a diff segment so assistant output can render
  // progressively instead of falling back to raw markdown text until close.
  const remaining = content.slice(lastIndex)
  if (remaining) {
    const openDiff = streaming ? remaining.match(/```(diff|patch)\s*(\S*)\n([\s\S]*)$/) : null
    if (openDiff && openDiff.index !== undefined) {
      const before = remaining.slice(0, openDiff.index)
      if (before) pushMarkdownSegments(segments, before)
      const filename = openDiff[2] ?? ""
      const diffContent = openDiff[3] ?? ""
      segments.push({
        type: "diff",
        content: normalizeUnifiedDiffHunks(diffContent.trimEnd()),
        file: filename || undefined,
      })
    } else {
      pushMarkdownSegments(segments, remaining)
    }
  }

  return segments
}
