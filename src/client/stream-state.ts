import { createSignal } from "solid-js"
import type { Part } from "../provider/types"

export function createStreamState() {
  const [parts, setParts] = createSignal<Part[]>([])

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
    reset: () => setParts([]),
  }
}
