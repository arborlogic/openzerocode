/**
 * Minimal Model Context Protocol (MCP) types and JSON-RPC framing for the
 * stdio transport. The stdio transport frames each JSON-RPC message as a single
 * line of JSON terminated by "\n" (messages must not contain embedded newlines).
 */

export const MCP_PROTOCOL_VERSION = "2024-11-05"

export type JsonRpcId = number | string

export type JsonRpcRequest = {
  jsonrpc: "2.0"
  id: JsonRpcId
  method: string
  params?: unknown
}

export type JsonRpcNotification = {
  jsonrpc: "2.0"
  method: string
  params?: unknown
}

export type JsonRpcResponse = {
  jsonrpc: "2.0"
  id: JsonRpcId
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export type McpToolSpec = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export type McpContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: string; [k: string]: unknown }

export type McpCallToolResult = {
  content?: McpContentPart[]
  isError?: boolean
}

/** Serialize a JSON-RPC message into a single newline-terminated line. */
export function encodeMessage(msg: JsonRpcRequest | JsonRpcNotification): string {
  return JSON.stringify(msg) + "\n"
}

/**
 * Split a growing buffer of stdout text into complete JSON-RPC messages,
 * returning the parsed messages and the unparsed remainder. Non-JSON lines
 * (e.g. stray server logging on stdout) are skipped.
 */
export function decodeMessages(buffer: string): { messages: JsonRpcResponse[]; rest: string } {
  const messages: JsonRpcResponse[] = []
  let rest = buffer
  let idx = rest.indexOf("\n")
  while (idx >= 0) {
    const line = rest.slice(0, idx).trim()
    rest = rest.slice(idx + 1)
    if (line.length > 0) {
      try {
        const parsed = JSON.parse(line) as JsonRpcResponse
        if (parsed && parsed.jsonrpc === "2.0") messages.push(parsed)
      } catch {
        // Skip non-JSON noise on stdout.
      }
    }
    idx = rest.indexOf("\n")
  }
  return { messages, rest }
}

/** Flatten an MCP tools/call result into plain text for the model. */
export function contentToText(result: McpCallToolResult): string {
  const parts = result.content ?? []
  const text = parts
    .map((p) => {
      if (p.type === "text" && typeof (p as { text?: unknown }).text === "string") return (p as { text: string }).text
      if (p.type === "image") return "[image omitted]"
      return JSON.stringify(p)
    })
    .filter(Boolean)
    .join("\n")
  return text || "(no output)"
}
