import type { Setter } from "solid-js"
import type { LogEntry } from "./log-entry"

export function createStreamState(
  setLogs: Setter<LogEntry[]>,
  renderAssistantText: (text: string) => string,
  stripAnsi: (text: string) => string,
) {
  let reasoningStreamIndex: number | undefined
  let streamingIndex: number | undefined

  const streamReasoningChunk = (text: string) => {
    setLogs((prev) => {
      if (reasoningStreamIndex === undefined) {
        const insertAt = streamingIndex !== undefined ? streamingIndex : prev.length
        const next = [...prev]
        next.splice(insertAt, 0, { role: "reasoning", text, title: "Thinking" })
        reasoningStreamIndex = insertAt
        if (streamingIndex !== undefined && streamingIndex >= insertAt) {
          streamingIndex += 1
        }
        return next
      }

      const next = [...prev]
      const current = next[reasoningStreamIndex]
      if (!current) return prev
      next[reasoningStreamIndex] = { ...current, text: current.text + text }
      return next
    })
  }

  const finalizeReasoningStream = (text: string) => {
    const finalText = stripAnsi(text).trim()
    setLogs((prev) => {
      if (reasoningStreamIndex === undefined) {
        if (!finalText) return prev
        const insertAt = streamingIndex !== undefined ? streamingIndex : prev.length
        const next = [...prev]
        next.splice(insertAt, 0, { role: "reasoning", text: finalText, title: "Thinking" })
        if (streamingIndex !== undefined && streamingIndex >= insertAt) {
          streamingIndex += 1
        }
        return next
      }

      const next = [...prev]
      if (!finalText) {
        next.splice(reasoningStreamIndex, 1)
        if (streamingIndex !== undefined && streamingIndex > reasoningStreamIndex) {
          streamingIndex -= 1
        }
        reasoningStreamIndex = undefined
        return next
      }

      const current = next[reasoningStreamIndex]
      if (!current) {
        reasoningStreamIndex = undefined
        return prev
      }

      next[reasoningStreamIndex] = { ...current, text: finalText, title: "Thinking" }
      reasoningStreamIndex = undefined
      return next
    })
  }

  const streamAssistantChunk = (text: string) => {
    setLogs((prev) => {
      if (streamingIndex === undefined) {
        const insertAt = reasoningStreamIndex !== undefined ? reasoningStreamIndex + 1 : prev.length
        const next = [...prev]
        next.splice(insertAt, 0, { role: "assistant", text })
        streamingIndex = insertAt
        return next
      }

      const next = [...prev]
      const current = next[streamingIndex]
      if (!current) return prev
      next[streamingIndex] = { ...current, text: current.text + text }
      return next
    })
  }

  const finalizeAssistantStream = (text: string) => {
    const finalText = renderAssistantText(text)
    setLogs((prev) => {
      if (streamingIndex === undefined) {
        return finalText ? [...prev, { role: "assistant", text: finalText }] : prev
      }

      const next = [...prev]
      if (!finalText) {
        next.splice(streamingIndex, 1)
        streamingIndex = undefined
        return next
      }

      const current = next[streamingIndex]
      if (!current) {
        streamingIndex = undefined
        return prev
      }

      next[streamingIndex] = { ...current, text: finalText }
      streamingIndex = undefined
      return next
    })
  }

  return {
    streamReasoningChunk,
    finalizeReasoningStream,
    streamAssistantChunk,
    finalizeAssistantStream,
  }
}
