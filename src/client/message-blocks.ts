import type { Message } from "../provider/types"
import { contentToText } from "../provider/content"
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
      const text = contentToText(msg.content)
      if (text) result.push({ kind: "assistant", text })
      return result
    }
    case "user": {
      const text = contentToText(msg.content)
      return text ? [{ kind: "user", text }] : []
    }
    case "tool": {
      const text = contentToText(msg.content)
      return text ? [{ kind: "tool", text, title: msg.tool_call_id }] : []
    }
    case "system": {
      const text = contentToText(msg.content)
      return text ? [{ kind: "system", text }] : []
    }
    default:
      return []
  }
}
