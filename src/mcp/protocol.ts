/**
 * Minimal Model Context Protocol (MCP) types and JSON-RPC framing for the
 * stdio transport. MCP stdio uses LSP-style `Content-Length` headers followed
 * by a JSON body. For compatibility with older/local test servers, the decoder
 * also accepts one-line JSON messages terminated by `\n`.
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

const CONTENT_LENGTH_RE = /^Content-Length:[ \t]*(\d+)\s*$/im
const HEADER_START_RE = /(?:^|\r?\n)Content-Length:[ \t]*\d+/i
const CRLF_HEADER_END_BYTES = Buffer.from("\r\n\r\n", "ascii")
const LF_HEADER_END_BYTES = Buffer.from("\n\n", "ascii")
const MAX_BUFFER_BYTES = 4 * 1024 * 1024

/** Serialize a JSON-RPC message using MCP stdio framing. */
export function encodeMessage(msg: JsonRpcRequest | JsonRpcNotification): string {
  const body = JSON.stringify(msg)
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`
}

/**
 * Split a growing buffer of stdout text into complete JSON-RPC messages,
 * returning the parsed messages and the unparsed remainder. Supports MCP's
 * Content-Length framing and a legacy newline-delimited fallback. Non-protocol
 * stdout noise is discarded so logs cannot grow the buffer forever.
 */
export function decodeMessages(buffer: string | Buffer): { messages: JsonRpcResponse[]; rest: Buffer } {
  const messages: JsonRpcResponse[] = []
  let rest = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer, "utf8")

  while (rest.length > 0) {
    const headerStart = findHeaderStart(rest)
    if (headerStart >= 0) {
      // Drop stray stdout before a real framed message. The stdio transport is
      // byte-framed, so align header/body offsets from the matched header start.
      if (headerStart > 0) {
        rest = rest.subarray(headerStart)
        continue
      }

      const headerEnd = findHeaderEnd(rest, 0)
      if (!headerEnd) break

      const header = rest.subarray(0, headerEnd.index).toString("ascii")
      const headerMatch = CONTENT_LENGTH_RE.exec(header)
      if (!headerMatch) {
        rest = rest.subarray(headerEnd.index + headerEnd.length)
        continue
      }

      const length = Number(headerMatch[1])
      if (!Number.isSafeInteger(length) || length < 0) {
        rest = rest.subarray(headerEnd.index + headerEnd.length)
        continue
      }

      const bodyStart = headerEnd.index + headerEnd.length
      const bodyEnd = bodyStart + length
      if (rest.length < bodyEnd) break

      const body = rest.subarray(bodyStart, bodyEnd).toString("utf8")
      rest = rest.subarray(bodyEnd)
      tryPushJsonRpc(messages, body)
      continue
    }

    const newline = rest.indexOf(0x0a)
    if (newline < 0) break
    const line = rest.subarray(0, newline).toString("utf8").trim()
    rest = rest.subarray(newline + 1)
    if (line.length > 0) tryPushJsonRpc(messages, line)
  }

  if (rest.length > MAX_BUFFER_BYTES) rest = rest.subarray(rest.length - MAX_BUFFER_BYTES)
  return { messages, rest }
}

function findHeaderStart(buffer: Buffer): number {
  const match = HEADER_START_RE.exec(buffer.toString("latin1"))
  if (!match) return -1
  return match[0].startsWith("\n") || match[0].startsWith("\r\n") ? match.index + match[0].indexOf("Content-Length") : match.index
}

function findHeaderEnd(buffer: Buffer, from: number): { index: number; length: number } | undefined {
  const crlf = buffer.indexOf(CRLF_HEADER_END_BYTES, from)
  const lf = buffer.indexOf(LF_HEADER_END_BYTES, from)
  if (crlf < 0 && lf < 0) return undefined
  if (crlf >= 0 && (lf < 0 || crlf <= lf)) return { index: crlf, length: CRLF_HEADER_END_BYTES.length }
  return { index: lf, length: LF_HEADER_END_BYTES.length }
}

function tryPushJsonRpc(messages: JsonRpcResponse[], text: string): void {
  try {
    const parsed = JSON.parse(text) as JsonRpcResponse
    if (parsed && parsed.jsonrpc === "2.0") messages.push(parsed)
  } catch {
    // Skip malformed protocol messages and non-JSON stdout noise.
  }
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
