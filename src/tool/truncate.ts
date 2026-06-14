const MAX_OUTPUT_BYTES = 10_000
const HEAD_LINES = 100
const TAIL_LINES = 50

const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })

function utf8Length(text: string): number {
  return encoder.encode(text).length
}

function decodePrefix(bytes: Uint8Array, length: number): string {
  for (let end = length; end >= Math.max(0, length - 3); end--) {
    try {
      return decoder.decode(bytes.subarray(0, end))
    } catch {}
  }
  return ""
}

function decodeSuffix(bytes: Uint8Array, length: number): string {
  const start = bytes.length - length
  for (let offset = start; offset <= Math.min(bytes.length, start + 3); offset++) {
    try {
      return decoder.decode(bytes.subarray(offset))
    } catch {}
  }
  return ""
}

function truncateBytes(text: string): string {
  const bytes = encoder.encode(text)
  if (bytes.length <= MAX_OUTPUT_BYTES) return text

  let marker = `\n\n...[truncated: ${bytes.length - MAX_OUTPUT_BYTES} more bytes]...\n\n`
  let available = MAX_OUTPUT_BYTES - utf8Length(marker)
  const headBytes = Math.ceil(available * 2 / 3)
  const tailBytes = available - headBytes
  const head = decodePrefix(bytes, headBytes)
  const tail = decodeSuffix(bytes, tailBytes)
  const keptBytes = utf8Length(head) + utf8Length(tail)

  marker = `\n\n...[truncated: ${bytes.length - keptBytes} more bytes]...\n\n`
  available = MAX_OUTPUT_BYTES - utf8Length(marker)
  if (keptBytes + utf8Length(marker) > MAX_OUTPUT_BYTES) {
    const adjustedHeadBytes = Math.ceil(available * 2 / 3)
    const adjustedTailBytes = available - adjustedHeadBytes
    return decodePrefix(bytes, adjustedHeadBytes) + marker + decodeSuffix(bytes, adjustedTailBytes)
  }
  return head + marker + tail
}

export function truncateToolOutput(text: string): string {
  // Preserve the beginning and end of verbose output: commands commonly put
  // summaries and errors at the end.
  const lines = text.split("\n")
  const lineLimited = lines.length <= HEAD_LINES + TAIL_LINES
    ? text
    : (
      lines.slice(0, HEAD_LINES).join("\n")
      + `\n\n...[${lines.length - HEAD_LINES - TAIL_LINES} lines omitted]\n\n`
      + lines.slice(-TAIL_LINES).join("\n")
    )
  return truncateBytes(lineLimited)
}
