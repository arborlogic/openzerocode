import { createSignal } from "solid-js"
import type { Part } from "../provider/types"

const FLUSH_INTERVAL_MS = 32 // ~30fps

/**
 * Buffers streamed text so rendering (and any dependent layout work) happens
 * at a bounded rate instead of once for every provider SSE delta.
 */
export function createStreamState(onTextFlush?: () => void) {
  const [parts, setParts] = createSignal<Part[]>([])

  // Pending buffers — flushed on next tick rather than on every chunk
  let assistantBuffer = ""
  let reasoningBuffer = ""
  let flushTimer: ReturnType<typeof setTimeout> | undefined

  function scheduleFlush() {
    if (flushTimer !== undefined) return
    flushTimer = setTimeout(() => {
      flushTimer = undefined
      const aText = assistantBuffer
      const rText = reasoningBuffer
      assistantBuffer = ""
      reasoningBuffer = ""
      if (!aText && !rText) return
      setParts((prev) => {
        let next = prev
        if (rText) {
          const last = next[next.length - 1]
          if (last?.type === "reasoning") {
            next = [...next.slice(0, -1), { type: "reasoning", text: last.text + rText }]
          } else {
            next = [...next, { type: "reasoning", text: rText }]
          }
        }
        if (aText) {
          const last = next[next.length - 1]
          if (last?.type === "text") {
            next = [...next.slice(0, -1), { type: "text", text: last.text + aText }]
          } else {
            next = [...next, { type: "text", text: aText }]
          }
        }
        return next
      })
      onTextFlush?.()
    }, FLUSH_INTERVAL_MS)
  }

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
      const resultAt = prev.findIndex((part) =>
        part.type === "tool-result" && ((key && part.id === key) || (!key && part.tool === input.tool)),
      )
      const next: Extract<Part, { type: "tool-result" }> = {
        type: "tool-result",
        id: input.id,
        tool: input.tool,
        output: input.output,
        error: input.error,
      }
      if (resultAt >= 0) return [...prev.slice(0, resultAt), next, ...prev.slice(resultAt + 1)]

      // A tool call and its running/result state occupy the same visual slot.
      // Replacing instead of appending prevents the live transcript from
      // growing by another row and then shrinking again when completed tools
      // are folded into their summary.
      const callAt = prev.findIndex((part) =>
        part.type === "tool-call" && ((key && part.id === key) || (!key && part.tool === input.tool)),
      )
      if (callAt >= 0) return [...prev.slice(0, callAt), next, ...prev.slice(callAt + 1)]
      return [...prev, next]
    })
  }

  const reset = () => {
    // Discard any pending buffered text before clearing parts
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer)
      flushTimer = undefined
    }
    assistantBuffer = ""
    reasoningBuffer = ""
    setParts([])
  }

  return {
    parts,
    setParts,
    streamReasoningChunk: (text: string) => {
      reasoningBuffer += text
      scheduleFlush()
    },
    streamAssistantChunk: (text: string) => {
      assistantBuffer += text
      scheduleFlush()
    },
    streamToolCallChunk,
    setToolResult,
    reset,
  }
}
