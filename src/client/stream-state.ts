import { createSignal } from "solid-js"
import type { Part } from "../provider/types"

export function createStreamState() {
  const [parts, setParts] = createSignal<Part[]>([])
  const streamToolCallChunk = (index: number, input: { id?: string; tool?: string; argumentsChunk?: string }) => {
    const fallbackId = `stream_tool_call_${index}`
    setParts((prev) => {
      const at = prev.findIndex((part) =>
        part.type === "tool-call" && (part.id === input.id || part.id === fallbackId),
      )
      if (at >= 0) {
        const current = prev[at] as Extract<Part, { type: "tool-call" }>
        const next: Extract<Part, { type: "tool-call" }> = {
          type: "tool-call",
          id: input.id ?? current.id,
          tool: input.tool ?? current.tool,
          input: current.input + (input.argumentsChunk ?? ""),
        }
        return [...prev.slice(0, at), next, ...prev.slice(at + 1)]
      }
      return [
        ...prev,
        {
          type: "tool-call",
          id: input.id ?? fallbackId,
          tool: input.tool ?? "unknown",
          input: input.argumentsChunk ?? "",
        },
      ]
    })
  }

  const setToolResult = (input: { id?: string; tool?: string; output: string; error?: boolean }) => {
    const key = input.id
    setParts((prev) => {
      const at = prev.findIndex((part) =>
        part.type === "tool-result" && ((key && part.id === key) || (!key && part.tool === input.tool)),
      )
      const next: Extract<Part, { type: "tool-result" }> = {
        type: "tool-result",
        id: input.id,
        tool: input.tool,
        output: input.output,
        error: input.error,
      }
      if (at >= 0) return [...prev.slice(0, at), next, ...prev.slice(at + 1)]
      return [...prev, next]
    })
  }

  return {
    parts,
    setParts,
    streamReasoningChunk: (text: string) => {
      setParts((prev) => {
        const last = prev[prev.length - 1]
        if (last?.type === "reasoning") {
          return [...prev.slice(0, -1), { type: "reasoning", text: last.text + text }]
        }
        return [...prev, { type: "reasoning", text }]
      })
    },
    streamAssistantChunk: (text: string) => {
      setParts((prev) => {
        const last = prev[prev.length - 1]
        if (last?.type === "text") {
          return [...prev.slice(0, -1), { type: "text", text: last.text + text }]
        }
        return [...prev, { type: "text", text }]
      })
    },
    streamToolCallChunk,
    setToolResult,
    reset: () => setParts([]),
  }
}
