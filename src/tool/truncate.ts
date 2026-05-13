const MAX_OUTPUT_CHARS = 40_000
const HEAD_LINES = 400
const TAIL_LINES = 50

export function truncateToolOutput(text: string): string {
  // Char budget first (avoids huge single-line outputs)
  if (text.length > MAX_OUTPUT_CHARS) {
    const omitted = text.length - MAX_OUTPUT_CHARS
    return text.slice(0, MAX_OUTPUT_CHARS) + `\n\n...[truncated: ${omitted} more chars]`
  }
  // Line budget
  const lines = text.split("\n")
  if (lines.length <= HEAD_LINES + TAIL_LINES) return text
  const omitted = lines.length - HEAD_LINES - TAIL_LINES
  return (
    lines.slice(0, HEAD_LINES).join("\n")
    + `\n\n...[${omitted} lines omitted]\n\n`
    + lines.slice(-TAIL_LINES).join("\n")
  )
}
