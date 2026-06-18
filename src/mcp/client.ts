import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
import {
  MCP_PROTOCOL_VERSION,
  encodeMessage,
  decodeMessages,
  contentToText,
  type JsonRpcId,
  type JsonRpcResponse,
  type McpToolSpec,
  type McpCallToolResult,
} from "./protocol"

export type McpServerSpec = {
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/**
 * A minimal MCP client over the stdio transport. Spawns the server process,
 * performs the initialize handshake, and exposes tools/list and tools/call.
 */
export class McpClient {
  private proc?: ChildProcessWithoutNullStreams
  private buffer = ""
  private nextId = 1
  private readonly pending = new Map<JsonRpcId, Pending>()
  private closed = false

  constructor(private readonly spec: McpServerSpec) {}

  /** Spawn the process and complete the MCP initialize handshake. */
  async start(): Promise<void> {
    const proc = spawn(this.spec.command, this.spec.args ?? [], {
      cwd: this.spec.cwd,
      env: { ...process.env, ...(this.spec.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams
    this.proc = proc

    proc.stdout.setEncoding("utf-8")
    proc.stdout.on("data", (chunk: string) => this.onStdout(chunk))
    proc.on("exit", () => this.failAll(new Error("MCP server exited")))
    proc.on("error", (err) => this.failAll(err instanceof Error ? err : new Error(String(err))))

    await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "openzerocode", version: "0.4.5" },
    })
    this.notify("notifications/initialized")
  }

  async listTools(): Promise<McpToolSpec[]> {
    const result = (await this.request("tools/list")) as { tools?: McpToolSpec[] }
    return result?.tools ?? []
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.request("tools/call", { name, arguments: args })) as McpCallToolResult
    const text = contentToText(result)
    return result?.isError ? `Error: ${text}` : text
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.failAll(new Error("MCP client closed"))
    try {
      this.proc?.stdin.end()
    } catch {}
    try {
      this.proc?.kill()
    } catch {}
  }

  get running(): boolean {
    return !this.closed && !!this.proc && this.proc.exitCode === null
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk
    const { messages, rest } = decodeMessages(this.buffer)
    this.buffer = rest
    for (const msg of messages) this.dispatch(msg)
  }

  private dispatch(msg: JsonRpcResponse): void {
    if (msg.id === undefined || msg.id === null) return // notification from server, ignore
    const pending = this.pending.get(msg.id)
    if (!pending) return
    this.pending.delete(msg.id)
    clearTimeout(pending.timer)
    if (msg.error) pending.reject(new Error(`${msg.error.message} (code ${msg.error.code})`))
    else pending.resolve(msg.result)
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed || !this.proc) return Promise.reject(new Error("MCP client not running"))
    const id = this.nextId++
    const payload = encodeMessage({ jsonrpc: "2.0", id, method, params })
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP request timed out: ${method}`))
      }, DEFAULT_REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.proc!.stdin.write(payload)
      } catch (err) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  }

  private notify(method: string, params?: unknown): void {
    if (this.closed || !this.proc) return
    try {
      this.proc.stdin.write(encodeMessage({ jsonrpc: "2.0", method, params }))
    } catch {}
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }
}
