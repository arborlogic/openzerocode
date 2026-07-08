import type { Message } from "../provider/types"
import type { DisplayBlock } from "./display-block"
import { tryParseJSON } from "./format-utils"

export function messageToBlocks(msg: Message): DisplayBlock[] {
  if (msg.parts && msg.parts.length > 0) {
    return msg.parts.map((part): DisplayBlock => {
      switch (part.type) {
        case "text":
          return { kind: "assistant", text: part.text }
        case "reasoning":
          return { kind: "reasoning", text: part.text, title: "Thinking" }
        case "tool-call": {
          const meta: Record<string, unknown> = {}
          const parsed = tryParseJSON(part.input)
          if (typeof parsed.filePath === "string") {
            meta.filePath = parsed.filePath
          }
          return { kind: "tool-call", text: part.input, title: part.tool, meta }
        }
        case "tool-result":
          return { kind: part.error ? "error" : "tool", text: part.output, title: part.tool }
        default:
          return { kind: "system", text: "" }
      }
    })
  }

  switch (msg.role) {
    case "assistant": {
      const result: DisplayBlock[] = []
      if (msg.reasoning_content) result.push({ kind: "reasoning", text: msg.reasoning_content, title: "Thinking" })
      if (msg.content) result.push({ kind: "assistant", text: msg.content })
      return result
    }
    case "user":
      return msg.content ? [{ kind: "user", text: msg.content }] : []
    case "tool":
      return msg.content ? [{ kind: "tool", text: msg.content, title: msg.tool_call_id }] : []
    case "system":
      return msg.content ? [{ kind: "system", text: msg.content }] : []
    default:
      return []
  }
}
