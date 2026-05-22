import { Effect, Layer } from "effect"
import { Provider, type Chunk, type CompletionRequest, type CompletionResult, type Message, type ToolCall, type ToolDef, type Usage } from "./types"
import { createAssistantMessage } from "./message-parts"
import type { ProviderDef } from "./registry"
import { hasCodexAuth, resolveCodexAuth } from "./codex-auth"

const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const MODELS = ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-codex", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2"]

type ResponseUsage = {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  input_tokens_details?: {
    cached_tokens?: number
  }
}

type ResponseOutputItem = {
  type?: string
  id?: string
  call_id?: string
  name?: string
  arguments?: string
  content?: Array<{ type?: string; text?: string }>
  summary?: Array<{ type?: string; text?: string }>
}

function parseSSE(text: string): { data: string; event?: string }[] {
  const messages: { data: string; event?: string }[] = []
  let event = ""
  let data = ""
  for (const line of text.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7)
    else if (line.startsWith("data: ")) data = line.slice(6)
    else if (line === "" && data) {
      if (data !== "[DONE]") messages.push({ data, event })
      event = ""
      data = ""
    }
  }
  if (data && data !== "[DONE]") messages.push({ data, event })
  return messages
}

function usageFromResponses(usage: ResponseUsage | undefined): Usage {
  const prompt = usage?.input_tokens ?? 0
  const completion = usage?.output_tokens ?? 0
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: usage?.total_tokens ?? prompt + completion,
    cached_tokens: cached,
  }
}

function responseToolCall(item: ResponseOutputItem, index = 0): ToolCall {
  return {
    id: item.call_id ?? item.id ?? `call_${index}`,
    index,
    type: "function",
    function: {
      name: item.name,
      arguments: item.arguments,
    },
  }
}

function responseToCompletion(raw: any, model: string): CompletionResult {
  const output = (raw.output ?? []) as ResponseOutputItem[]
  const content = output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text" || part.type === "text")
    .map((part) => part.text ?? "")
    .join("")
  const reasoning = output
    .filter((item) => item.type === "reasoning")
    .flatMap((item) => item.summary ?? [])
    .map((part) => part.text ?? "")
    .join("")
  const toolCalls = output
    .map((item, index) => item.type === "function_call" ? responseToolCall(item, index) : undefined)
    .filter((item): item is ToolCall => Boolean(item))

  return {
    id: raw.id ?? `codex_${Date.now()}`,
    model: raw.model ?? model,
    message: createAssistantMessage({
      content: content || undefined,
      reasoning_content: reasoning || undefined,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    }),
    usage: usageFromResponses(raw.usage),
  }
}

function splitInstructions(messages: Message[]) {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content ?? "")
    .filter(Boolean)
    .join("\n")
  return {
    instructions: instructions || "You are a helpful coding assistant.",
    messages: messages.filter((message) => message.role !== "system"),
  }
}

function messagesToInput(messages: Message[]) {
  const input: any[] = []
  for (const message of messages) {
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: message.content ?? "",
      })
      continue
    }

    if (message.role === "assistant") {
      if (message.content) {
        input.push({
          role: "assistant",
          content: [{ type: "output_text", text: message.content }],
        })
      }
      for (const call of message.tool_calls ?? []) {
        input.push({
          type: "function_call",
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments ?? "{}",
        })
      }
      continue
    }

    input.push({
      role: message.role,
      content: [{ type: "input_text", text: message.content ?? "" }],
    })
  }
  return input
}

function toolsToResponsesTools(tools: ToolDef[] | undefined) {
  return tools?.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }))
}

export function toCodexRequestBody(req: CompletionRequest) {
  const { instructions, messages } = splitInstructions(req.messages)
  return {
    model: req.model,
    instructions,
    input: messagesToInput(messages),
    tools: toolsToResponsesTools(req.tools),
    stream: req.stream,
    max_output_tokens: req.max_tokens,
    store: false,
  }
}

export const layer = (input: { model?: string }) =>
  Layer.effect(
    Provider,
    Effect.gen(function* () {
      const defaultModel = input.model ?? "gpt-5.4"

      async function headers() {
        const auth = await resolveCodexAuth()
        const result: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.access}`,
          originator: "opencode",
          "User-Agent": "openzerocode/codex-auth",
        }
        if (auth.accountId) result["ChatGPT-Account-Id"] = auth.accountId
        return result
      }

      const complete = (req: CompletionRequest) =>
        Effect.gen(function* () {
          const model = req.model || defaultModel
          const res = yield* Effect.promise(async () =>
            fetch(CODEX_API_ENDPOINT, {
              method: "POST",
              headers: await headers(),
              body: JSON.stringify({ ...toCodexRequestBody({ ...req, model }), stream: false }),
            })
          )
          if (!res.ok) {
            const text = yield* Effect.promise(() => res.text())
            return yield* Effect.die(new Error(`Codex API error ${res.status}: ${text}`))
          }
          const json = yield* Effect.promise(() => res.json()) as Effect.Effect<any>
          return responseToCompletion(json, model)
        }).pipe(Effect.orDie)

      const stream = (req: CompletionRequest) =>
        Effect.gen(function* () {
          const model = req.model || defaultModel
          const res = yield* Effect.promise(async () =>
            fetch(CODEX_API_ENDPOINT, {
              method: "POST",
              headers: await headers(),
              body: JSON.stringify({ ...toCodexRequestBody({ ...req, model }), stream: true }),
            })
          )
          if (!res.ok) {
            const text = yield* Effect.promise(() => res.text())
            return yield* Effect.die(new Error(`Codex API error ${res.status}: ${text}`))
          }
          const body = res.body
          if (!body) return yield* Effect.die(new Error("No response body"))

          const reader = body.getReader()
          const decoder = new TextDecoder()
          let buffer = ""
          const argumentDeltas = new Set<number>()

          return new ReadableStream<Chunk>({
            async pull(controller) {
              while (true) {
                const { done, value } = await reader.read()
                if (done) {
                  controller.close()
                  return
                }
                buffer += decoder.decode(value, { stream: true })
                const parts = buffer.split("\n\n")
                buffer = parts.pop() ?? ""
                for (const part of parts) {
                  for (const msg of parseSSE(part)) {
                    let raw: any
                    try { raw = JSON.parse(msg.data) } catch { continue }
                    const type = raw.type ?? msg.event
                    if (type === "response.output_text.delta") {
                      controller.enqueue({ delta: { content: raw.delta ?? "" } })
                    } else if (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") {
                      controller.enqueue({ delta: { reasoning_content: raw.delta ?? "" } })
                    } else if (type === "response.output_item.added" && raw.item?.type === "function_call") {
                      controller.enqueue({ delta: {}, tool_calls: [responseToolCall(raw.item, raw.output_index ?? 0)] })
                    } else if (type === "response.function_call_arguments.delta") {
                      const index = raw.output_index ?? 0
                      argumentDeltas.add(index)
                      controller.enqueue({
                        delta: {},
                        tool_calls: [{
                          id: raw.call_id,
                          index,
                          type: "function",
                          function: { arguments: raw.delta ?? "" },
                        }],
                      })
                    } else if (type === "response.output_item.done" && raw.item?.type === "function_call") {
                      const index = raw.output_index ?? 0
                      if (!argumentDeltas.has(index)) {
                        controller.enqueue({ delta: {}, tool_calls: [responseToolCall(raw.item, index)] })
                      }
                    } else if (type === "response.completed") {
                      controller.enqueue({ delta: {}, finish_reason: "stop", usage: usageFromResponses(raw.response?.usage) })
                    } else if (type === "response.incomplete") {
                      controller.enqueue({ delta: {}, finish_reason: "length", usage: usageFromResponses(raw.response?.usage) })
                    }
                  }
                }
              }
            },
            cancel() { reader.cancel() },
          })
        }).pipe(Effect.orDie)

      const models = () => Effect.succeed(MODELS.map((id) => ({ id })))

      return { complete, stream, models }
    }).pipe(Effect.orDie),
  )

export const def: ProviderDef = {
  id: "openai-codex",
  name: "OpenAI Codex",
  defaultModel: "gpt-5.4",
  authOptional: true,
  detectAuth: hasCodexAuth,
  factory: (cfg) => layer({ model: cfg.model }),
}
