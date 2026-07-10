import { parseImageDataUrl } from "./content"
import type { Message, Part, ToolCall, ContentPart } from "./types"

function textPart(text: string | undefined): Part[] {
  return text ? [{ type: "text", text }] : []
}

function reasoningPart(text: string | undefined): Part[] {
  return text ? [{ type: "reasoning", text }] : []
}

function toolCallParts(toolCalls: ToolCall[] | undefined): Part[] {
  return (toolCalls ?? []).map((call) => ({
    type: "tool-call",
    id: call.id,
    tool: call.function.name ?? "unknown",
    input: call.function.arguments ?? "{}",
  }))
}

export function createAssistantMessage(input: {
  content?: string
  reasoning_content?: string
  tool_calls?: ToolCall[]
}): Message {
  const parts: Part[] = [
    ...reasoningPart(input.reasoning_content),
    ...textPart(input.content),
    ...toolCallParts(input.tool_calls),
  ]

  return {
    role: "assistant",
    content: input.content,
    reasoning_content: input.reasoning_content,
    tool_calls: input.tool_calls,
    parts: parts.length > 0 ? parts : undefined,
  }
}

export function createToolMessage(input: {
  tool_call_id?: string
  tool?: string
  output: string
  error?: boolean
  contentParts?: ContentPart[]
}): Message {
  // When images are present, use multimodal content format so the LLM can see them.
  const content = input.contentParts && input.contentParts.length > 0
    ? input.contentParts
    : input.output

  // Build parts array: always include the text tool-result for TUI display,
  // plus image parts so they survive in the message history.
  const parts: Part[] = [
    { type: "tool-result", id: input.tool_call_id, tool: input.tool, output: input.output, error: input.error },
  ]
  if (input.contentParts) {
    for (const cp of input.contentParts) {
      if (cp.type === "image_url") {
        const image = parseImageDataUrl(cp.image_url?.url ?? "")
        if (image) {
          parts.push({ type: "image", mimeType: image.mimeType, base64: image.base64 })
        }
      }
    }
  }

  return {
    role: "tool",
    tool_call_id: input.tool_call_id,
    content,
    parts,
  }
}
