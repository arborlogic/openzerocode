import type { Message } from "../provider/types"

export function sanitizeMessages(messages: Message[]): Message[] {
  const out: Message[] = []
  const seenToolCallIds = new Set<string>()
  let i = 0

  while (i < messages.length) {
    const msg = messages[i]

    if (msg?.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      const requiredIds = new Set(msg.tool_calls.map((tc) => tc.id))
      const toolMsgs: Message[] = []
      let j = i + 1
      while (j < messages.length && messages[j]?.role === "tool") {
        toolMsgs.push(messages[j]!)
        j++
      }
      const foundIds = new Set(toolMsgs.map((m) => m.tool_call_id).filter(Boolean))
      if ([...requiredIds].every((id) => foundIds.has(id))) {
        out.push(msg)
        for (const tm of toolMsgs) {
          out.push(tm)
          if (tm.tool_call_id) seenToolCallIds.add(tm.tool_call_id)
        }
      }
      i = j
      continue
    }

    if (msg?.role === "tool") {
      // Drop orphaned tool messages that have no preceding assistant
      // with a matching tool_calls entry (e.g., after compaction split)
      if (msg.tool_call_id && seenToolCallIds.has(msg.tool_call_id)) {
        out.push(msg)
      }
      i++
      continue
    }

    if (msg) {
      // Strip display-only fields before sending to the API
      if (msg.origin !== undefined) {
        const { origin: _, ...clean } = msg
        out.push(clean)
      } else {
        out.push(msg)
      }
    }
    i++
  }

  return out
}
