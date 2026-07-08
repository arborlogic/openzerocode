export type DisplayBlock = {
  kind: "user" | "assistant" | "reasoning" | "tool" | "tool-call" | "error" | "system"
  text: string
  title?: string
  streaming?: boolean
  /** Extra metadata (e.g. file path for write/read_file tool results) */
  meta?: Record<string, unknown>
}
