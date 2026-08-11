import { parseDiffBlocks } from "./markdown-diff-parser"

export type DisplayBlock = {
  kind: "user" | "assistant" | "reasoning" | "tool" | "tool-call" | "error" | "system"
  text: string
  title?: string
  streaming?: boolean
  /**
   * Keep a block's slot in the transcript while omitting it from the layout.
   * This prevents hiding a preceding tool/reasoning block from shifting every
   * later indexed renderable and briefly painting stale content.
   */
  hidden?: boolean
  /** Extra metadata (e.g. file path for write/read_file tool results) */
  meta?: Record<string, unknown>
}

const MARKDOWN_BLOCK_PATTERN = /(?:^|\n)(?:\s*\n|#{1,6}\s|```|~~~|\s*[-*+]\s|\s*\d+[.)]\s|>\s)/g
const MAX_ASSISTANT_MOUNT_WEIGHT = 120

function assistantMountWeight(entry: DisplayBlock): number {
  // Streaming assistant text uses one plain <text>, regardless of its Markdown
  // structure. Completed responses may switch to segmented custom rendering,
  // where every table row owns a TextBuffer and each segment owns a renderable.
  if (entry.streaming) return 2

  const markdownBlocks = entry.text.match(MARKDOWN_BLOCK_PATTERN)?.length ?? 0
  const segments = parseDiffBlocks(entry.text)
  const tableRows = segments.reduce(
    (total, segment) => total + (segment.type === "table" ? segment.table.rows.length + 4 : 0),
    0,
  )
  const customSegments = segments.filter((segment) => segment.type !== "markdown").length

  return Math.min(
    MAX_ASSISTANT_MOUNT_WEIGHT,
    2 + Math.ceil(markdownBlocks / 4) + tableRows + customSegments,
  )
}

/** Conservative estimate of native text resources owned by a visible block. */
export function displayBlockMountWeight(entry: DisplayBlock): number {
  switch (entry.kind) {
    case "assistant":
      return assistantMountWeight(entry)
    case "tool":
    case "tool-call":
      return entry.streaming ? 4 : 6
    case "reasoning":
      return 3
    case "user":
      return 2
    case "error":
      return 2
    case "system":
      return 1
  }
}

/**
 * Fields that select initialization-time rendering branches in
 * ResponseEntry. A changed key must remount the body even when its parent
 * deliberately preserves the positional list slot.
 */
export function responseEntryRenderKey(entry: DisplayBlock): string {
  return `${entry.kind}\u0000${entry.title ?? ""}`
}
