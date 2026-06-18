export type MarkdownDiffSegment =
  | { type: "markdown"; content: string }
  | { type: "diff"; content: string; file?: string }

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
      segments.push({ type: "markdown", content: before })
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
      if (before) segments.push({ type: "markdown", content: before })
      const filename = openDiff[2] ?? ""
      const diffContent = openDiff[3] ?? ""
      segments.push({
        type: "diff",
        content: normalizeUnifiedDiffHunks(diffContent.trimEnd()),
        file: filename || undefined,
      })
    } else {
      segments.push({ type: "markdown", content: remaining })
    }
  }

  return segments
}
