import type { Message } from "../provider/types"

// Stream chunk format for the HTTP server's NDJSON streaming endpoint.
// Also used as the internal yield type of streamSession() so the TUI and the
// HTTP server can share a single source of truth.
//
// "message" chunks carry the full Message object; HTTP clients can use them to
// reconstruct conversation state, while the TUI uses them to commit streamed
// content into discrete message blocks.

export type StreamChunk =
  | { type: "text"; content: string }
  | { type: "reasoning"; content: string }
  | { type: "tool_call_delta"; index: number; id?: string; tool?: string; argumentsChunk?: string }
  | { type: "tool_start"; id: string; name: string; input: string }
  | { type: "tool_result"; id: string; name: string; output: string; error: boolean }
  | { type: "message"; message: Message }
  | { type: "status"; text: string }
  | { type: "notice"; kind: string; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; cachedInputTokens: number }
  | { type: "error"; message: string }
  | { type: "done" }
