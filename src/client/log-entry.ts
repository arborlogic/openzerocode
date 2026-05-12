export type LogEntry = {
  role: "system" | "user" | "assistant" | "tool" | "error" | "reasoning"
  text: string
  title?: string
}
