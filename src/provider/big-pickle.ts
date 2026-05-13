import { Effect, Layer } from "effect"
import { Provider, type CompletionRequest, type CompletionResult, type Chunk } from "./types"
import { createAssistantMessage } from "./message-parts"
import type { ProviderDef } from "./registry"

const ANONYMOUS_MODELS = [
  "big-pickle",
  "deepseek-v4-flash-free",
  "minimax-m2.5-free",
  "ring-2.6-1t-free",
  "nemotron-3-super-free",
]

export function hasBigPickleApiKey() {
  return Boolean(process.env.OPENCODE_API || process.env.OPENCODE_API_KEY)
}

export function filterBigPickleModels(models: string[]) {
  if (hasBigPickleApiKey()) return models
  return models.filter((model) => ANONYMOUS_MODELS.includes(model))
}

export function normalizeBigPickleModel(model: string) {
  if (hasBigPickleApiKey()) return model
  return ANONYMOUS_MODELS.includes(model) ? model : "big-pickle"
}

function parseSSE(text: string): { data: string; event?: string }[] {
  const messages: { data: string; event?: string }[] = []
  let event = ""
  let data = ""
  for (const line of text.split("\n")) {
    if (line.startsWith("event: ")) event = line.slice(7)
    else if (line.startsWith("data: ")) {
      data = line.slice(6)
      if (data === "[DONE]") continue
      try { JSON.parse(data) } catch { continue }
      messages.push({ data, event })
    } else if (line === "" && data) {
      try { JSON.parse(data) } catch { continue }
      messages.push({ data, event })
      event = ""
      data = ""
    }
  }
  return messages
}

function openaiChunkToChunk(raw: any): Chunk {
  const delta = raw.choices?.[0]?.delta ?? {}
  const finish = raw.choices?.[0]?.finish_reason
  const toolCalls = delta.tool_calls?.map((tc: any) => ({
    id: tc.id,
    type: "function" as const,
    function: tc.function,
  }))
  return {
    delta: { content: delta.content ?? undefined, reasoning_content: delta.reasoning_content ?? undefined },
    tool_calls: toolCalls,
    finish_reason: finish ?? undefined,
    usage: raw.usage ?? undefined,
  }
}

const DEFAULT_BASE = "https://opencode.ai/zen/v1"

export const layer = (input: { apiKey: string; baseURL?: string; model?: string }) =>
  Layer.effect(
    Provider,
    Effect.gen(function* () {
      const baseURL = input.baseURL ?? DEFAULT_BASE
      const defaultModel = input.model ?? "big-pickle"

      function headers() {
        return {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.apiKey}`,
        }
      }

      const complete = (req: CompletionRequest) =>
        Effect.gen(function* () {
          const res = yield* Effect.promise(() =>
            fetch(`${baseURL}/chat/completions`, {
              method: "POST",
              headers: headers(),
              body: JSON.stringify({ ...req, model: req.model || defaultModel, stream: false }),
            })
          )
          if (!res.ok) {
            const text = yield* Effect.promise(() => res.text())
            return yield* Effect.die(new Error(`API error ${res.status}: ${text}`))
          }
          const json = yield* Effect.promise(() => res.json()) as Effect.Effect<any>
          const choice = json.choices?.[0]
          return {
            id: json.id,
            model: json.model,
            message: createAssistantMessage({
              content: choice?.message?.content ?? undefined,
              reasoning_content: choice?.message?.reasoning_content ?? undefined,
              tool_calls: choice?.message?.tool_calls,
            }),
            usage: json.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          } satisfies CompletionResult
        }).pipe(Effect.orDie)

      const stream = (req: CompletionRequest) =>
        Effect.gen(function* () {
          const res = yield* Effect.promise(() =>
            fetch(`${baseURL}/chat/completions`, {
              method: "POST",
              headers: headers(),
              body: JSON.stringify({ ...req, model: req.model || defaultModel, stream: true }),
            })
          )
          if (!res.ok) {
            const text = yield* Effect.promise(() => res.text())
            return yield* Effect.die(new Error(`API error ${res.status}: ${text}`))
          }
          const body = res.body
          if (!body) return yield* Effect.die(new Error("No response body"))

          const reader = body.getReader()
          const decoder = new TextDecoder()
          let buffer = ""

          const result = new ReadableStream<Chunk>({
            async pull(controller) {
              while (true) {
                const { done, value } = await reader.read()
                if (done) { controller.close(); return }
                buffer += decoder.decode(value, { stream: true })
                const parts = buffer.split("\n\n")
                buffer = parts.pop() ?? ""
                for (const part of parts) {
                  for (const msg of parseSSE(part)) {
                    controller.enqueue(openaiChunkToChunk(JSON.parse(msg.data)))
                  }
                }
              }
            },
            cancel() { reader.cancel() },
          })
          return result
        }).pipe(Effect.orDie)

      const models = () =>
        Effect.gen(function* () {
          const res = yield* Effect.promise(() =>
            fetch(`${baseURL}/models`, { headers: headers() })
          )
          const json = yield* Effect.promise(() => res.json()) as Effect.Effect<any>
          return filterBigPickleModels((json.data ?? []).map((m: any) => m.id) as string[])
        }).pipe(Effect.orDie)

      return { complete, stream, models }
    }).pipe(Effect.orDie),
  )

export const def: ProviderDef = {
  id: "openapi",
  name: "OpenAPI",
  env: { apiKey: ["OPENCODE_API", "OPENCODE_API_KEY"], baseURL: "OPENCODE_BASE_URL", authOptional: true },
  factory: (cfg) => layer({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, model: cfg.model }),
}
