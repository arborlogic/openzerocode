import { Effect, Layer } from "effect"
import { Provider, type CompletionRequest, type CompletionResult, type Chunk, type Message, type Usage } from "./types"
import { createAssistantMessage } from "./message-parts"
import type { ProviderDef } from "./registry"
import { resolveConfiguredProviderApiKey } from "./config"

const ANONYMOUS_DEFAULT_MODEL = "big-pickle"

export function isAnonymousBigPickleModel(model: string) {
  return model === ANONYMOUS_DEFAULT_MODEL || model.endsWith("-free")
}

export function hasBigPickleApiKey() {
  return Boolean(resolveConfiguredProviderApiKey("opencode-zen"))
}

export function filterBigPickleModels(models: string[]) {
  if (hasBigPickleApiKey()) return models
  return models.filter((model) => isAnonymousBigPickleModel(model))
}

export function normalizeBigPickleModel(model: string) {
  if (hasBigPickleApiKey()) return model
  return isAnonymousBigPickleModel(model) ? model : ANONYMOUS_DEFAULT_MODEL
}

// Standard SSE parser: accumulates data: lines until an empty line (event boundary),
// then flushes the concatenated data. This avoids duplicate dispatch on data: + empty line.
function parseSSE(text: string): { data: string; event?: string }[] {
  const messages: { data: string; event?: string }[] = []
  let event = ""
  const dataLines: string[] = []

  const flush = () => {
    const data = dataLines.join("")
    dataLines.length = 0
    if (!data || data === "[DONE]") { event = ""; return }
    try { JSON.parse(data) } catch { event = ""; return }
    messages.push({ data, event })
    event = ""
  }

  for (const line of text.split("\n")) {
    if (line.startsWith("event: ")) {
      event = line.slice(7)
    } else if (line.startsWith("data: ")) {
      dataLines.push(line.slice(6))
    } else if (line === "") {
      flush()
    }
  }
  // Flush any remaining data (handles streams that end without a final \n\n)
  flush()
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
    usage: usageFromOpenAI(raw.usage),
  }
}

function usageFromOpenAI(usage: any): Usage | undefined {
  if (!usage) return undefined
  const prompt = usage.prompt_tokens ?? 0
  const completion = usage.completion_tokens ?? 0
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: usage.total_tokens ?? prompt + completion,
    cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
  }
}

function sanitizeMessages(messages: Message[]): Message[] {
  return messages.map(({ parts, ...rest }) => rest)
}

const DEFAULT_BASE = "https://opencode.ai/zen/v1"

export const layer = (input: { apiKey: string; baseURL?: string; model?: string; filterModels?: boolean }) =>
  Layer.effect(
    Provider,
    Effect.gen(function* () {
      const baseURL = input.baseURL ?? DEFAULT_BASE
      const defaultModel = input.model ?? ANONYMOUS_DEFAULT_MODEL

      function headers() {
        return {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.apiKey || "public"}`,
        }
      }

      const complete = (req: CompletionRequest) =>
        Effect.gen(function* () {
          const { signal, ...wire } = req
          const res = yield* Effect.promise(() =>
            fetch(`${baseURL}/chat/completions`, {
              method: "POST",
              headers: headers(),
              body: JSON.stringify({ ...wire, messages: sanitizeMessages(req.messages), model: req.model || defaultModel, stream: false }),
              signal,
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
            usage: usageFromOpenAI(json.usage) ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0 },
          } satisfies CompletionResult
        }).pipe(Effect.orDie)

      const stream = (req: CompletionRequest) =>
        Effect.gen(function* () {
          const { signal, ...wire } = req
          const res = yield* Effect.promise(() =>
            fetch(`${baseURL}/chat/completions`, {
              method: "POST",
              headers: headers(),
              body: JSON.stringify({ ...wire, messages: sanitizeMessages(req.messages), model: req.model || defaultModel, stream: true, stream_options: { include_usage: true } }),
              signal,
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
          // Timeout per individual read: if no bytes arrive within this window the
          // stream is considered stalled and we tear it down so the caller can retry.
          const READ_TIMEOUT_MS = 120_000

          const readWithTimeout = async (): Promise<{ done: boolean; value?: Uint8Array }> => {
            let timer: ReturnType<typeof setTimeout> | undefined
            const timeout = new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => reject(new Error("Stream read timeout")), READ_TIMEOUT_MS)
            })
            try {
              const result = await Promise.race([reader.read(), timeout])
              return result
            } finally {
              if (timer) clearTimeout(timer)
            }
          }

          const result = new ReadableStream<Chunk>({
            async pull(controller) {
              while (true) {
                let done: boolean | undefined
                let value: Uint8Array | undefined
                try {
                  const result = await readWithTimeout()
                  done = result.done
                  value = result.value
                } catch (err) {
                  // Read timed out or errored — cancel the underlying reader and
                  // surface the failure to consumers instead of ending silently.
                  try { await reader.cancel(err) } catch { /* ignore cancel failures */ }
                  if (buffer) {
                    const parts = buffer.split("\n\n")
                    for (const part of parts) {
                      if (!part) continue
                      for (const msg of parseSSE(part)) {
                        try { controller.enqueue(openaiChunkToChunk(JSON.parse(msg.data))) } catch { /* skip unparseable */ }
                      }
                    }
                  }
                  try { controller.error(err) } catch { /* already errored */ }
                  return
                }
                if (done) {
                  // Flush any remaining buffered data before closing.
                  if (buffer) {
                    const parts = buffer.split("\n\n")
                    for (const part of parts) {
                      if (!part) continue
                      for (const msg of parseSSE(part)) {
                        try { controller.enqueue(openaiChunkToChunk(JSON.parse(msg.data))) } catch { /* skip unparseable */ }
                      }
                    }
                  }
                  try { controller.close() } catch { /* already closed */ }
                  return
                }
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
          const ids = (json.data ?? []).map((m: any) => m.id) as string[]
          const filtered = (input.filterModels ?? true) ? filterBigPickleModels(ids) : ids
          return filtered.map((id) => ({ id }))
        }).pipe(Effect.orDie)

      return { complete, stream, models }
    }).pipe(Effect.orDie),
  )

export const def: ProviderDef = {
  id: "opencode-zen",
  name: "OpenCode Zen",
  defaultModel: ANONYMOUS_DEFAULT_MODEL,
  authOptional: true,
  envKeys: ["OPENCODE_API", "OPENCODE_API_KEY"],
  factory: (cfg) => layer({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, model: cfg.model }),
}
