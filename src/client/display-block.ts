export type DisplayBlock = {
  kind: "user" | "assistant" | "reasoning" | "tool" | "tool-call" | "error" | "system"
  text: string
  title?: string
  streaming?: boolean
  /** Extra metadata (e.g. file path for write/read_file tool results) */
  meta?: Record<string, unknown>
}

/**
 * Fields that select initialization-time rendering branches in
 * ResponseEntry. A changed key must remount the body even when its parent
 * deliberately preserves the positional list slot.
 */
export function responseEntryRenderKey(entry: DisplayBlock): string {
  return `${entry.kind}\u0000${entry.title ?? ""}`
}
