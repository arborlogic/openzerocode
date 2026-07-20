import { Effect, Layer } from "effect"
import { Provider, type CompletionRequest, type CompletionResult, type ToolCall, type Usage } from "./types"
import { createAssistantMessage } from "./message-parts"
import type { ProviderDef } from "./registry"
import { hasCodexAuth, resolveCodexAuth } from "./codex-auth"
import {
  createResponsesStream,
  toResponsesRequestBody,
} from "./responses-api"

const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const MODELS = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.4-codex",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2",
]

export function toCodexRequestBody(req: CompletionRequest) {
  // The ChatGPT Codex Responses endpoint accepts streaming requests only.
  // `complete()` below consumes that stream and returns an aggregated result.
  // Unlike the public OpenAI Responses API, it also rejects
  // `max_output_tokens` (including when it is undefined).
  const { max_output_tokens: _maxOutputTokens, ...body } = toResponsesRequestBody({ ...req, stream: true })
  return body
}

export async function collectCodexCompletion(
  stream: ReadableStream<{ delta: { content?: string; reasoning_content?: string }; tool_calls?: ToolCall[]; usage?: Usage }>,
  model: string,
): Promise<CompletionResult> {
  const reader = stream.getReader()
  let content = ""
  let reasoning = ""
  let usage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  const toolCalls = new Map<number, ToolCall>()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      content += value.delta.content ?? ""
      reasoning += value.delta.reasoning_content ?? ""
      if (value.usage) usage = value.usage
      for (const toolCall of value.tool_calls ?? []) {
        const index = toolCall.index ?? 0
        const previous = toolCalls.get(index)
        toolCalls.set(index, {
          id: toolCall.id || previous?.id || `call_${index}`,
          index,
          type: "function",
          function: {
            name: toolCall.function.name || previous?.function.name,
            arguments: `${previous?.function.arguments ?? ""}${toolCall.function.arguments ?? ""}`,
          },
        })
      }
    }
  } finally {
    reader.releaseLock()
  }

  return {
    id: `codex_${Date.now()}`,
    model,
    message: createAssistantMessage({
      content: content || undefined,
      reasoning_content: reasoning || undefined,
      tool_calls: toolCalls.size ? [...toolCalls.values()] : undefined,
    }),
    usage,
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
          const { signal, ...wire } = req
          const res = yield* Effect.promise(async () =>
            fetch(CODEX_API_ENDPOINT, {
              method: "POST",
              headers: await headers(),
              body: JSON.stringify(toCodexRequestBody({ ...wire, model })),
              signal,
            }),
          )
          if (!res.ok) {
            const text = yield* Effect.promise(() => res.text())
            return yield* Effect.die(new Error(`Codex API error ${res.status}: ${text}`))
          }
          const body = res.body
          if (!body) return yield* Effect.die(new Error("No response body"))
          return yield* Effect.promise(() => collectCodexCompletion(createResponsesStream(body, signal), model))
        }).pipe(Effect.orDie)

      const stream = (req: CompletionRequest) =>
        Effect.gen(function* () {
          const model = req.model || defaultModel
          const { signal, ...wire } = req
          const res = yield* Effect.promise(async () =>
            fetch(CODEX_API_ENDPOINT, {
              method: "POST",
              headers: await headers(),
              body: JSON.stringify(toCodexRequestBody({ ...wire, model })),
              signal,
            }),
          )
          if (!res.ok) {
            const text = yield* Effect.promise(() => res.text())
            return yield* Effect.die(new Error(`Codex API error ${res.status}: ${text}`))
          }
          const body = res.body
          if (!body) return yield* Effect.die(new Error("No response body"))
          return createResponsesStream(body, signal)
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
