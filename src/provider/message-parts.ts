import type { Message, Part, ToolCall } from "./types"

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
}): Message {
  return {
    role: "tool",
    tool_call_id: input.tool_call_id,
    content: input.output,
    parts: [{ type: "tool-result", id: input.tool_call_id, tool: input.tool, output: input.output, error: input.error }],
  }
}
