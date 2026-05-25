import { Effect, Context, Schema } from "effect"

export type Role = "user" | "assistant" | "system" | "tool"

export type ToolCall = {
  id: string
  index?: number
  type: "function"
  function: { name?: string; arguments?: string }
}

export type Part =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; id: string; tool: string; input: string }
  | { type: "tool-result"; id?: string; tool?: string; output: string; error?: boolean }

export type Message = {
  role: Role
  content?: string
  reasoning_content?: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
  parts?: Part[]
}

export type ToolDef = {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type CompletionRequest = {
  model: string
  messages: Message[]
  tools?: ToolDef[]
  stream: boolean
  max_tokens?: number
  temperature?: number
  /**
   * Optional AbortSignal threaded into the underlying fetch so the upstream
   * HTTP request is torn down promptly when the caller cancels. Without this,
   * stream consumers can break out of their read loop but the network request
   * keeps running in the background until the upstream finishes.
   */
  signal?: AbortSignal
}

export type Usage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  cached_tokens?: number
}

export type CompletionResult = {
  id: string
  model: string
  message: Message
  usage: Usage
}

export type Chunk = {
  delta: { content?: string; reasoning_content?: string }
  tool_calls?: ToolCall[]
  finish_reason?: string | null
  usage?: Usage
}

export type ModelInfo = {
  id: string
  contextLimit?: number
  pricing?: {
    input: number
    output: number
  }
}

export interface Interface {
  readonly complete: (req: CompletionRequest) => Effect.Effect<CompletionResult>
  readonly stream: (req: CompletionRequest) => Effect.Effect<ReadableStream<Chunk>>
  readonly models: () => Effect.Effect<ModelInfo[]>
}

export class Provider extends Context.Service<Provider, Interface>()("@openzerocode/Provider") {}
