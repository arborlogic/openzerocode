export type MarkdownDiffSegment =
  | { type: "markdown"; content: string }
  | { type: "diff"; content: string; file?: string }

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
    const cleanDiff = diffContent.trimEnd()

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
        content: diffContent.trimEnd(),
        file: filename || undefined,
      })
    } else {
      segments.push({ type: "markdown", content: remaining })
    }
  }

  return segments
}
