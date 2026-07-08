import { Effect, Layer } from "effect"
import { Provider, type CompletionRequest, type CompletionResult, type Chunk, type Message, type ToolCall, type Usage } from "./types"
import { contentToText, parseImageDataUrl } from "./content"
import { createAssistantMessage } from "./message-parts"
import type { ProviderDef } from "./registry"

const DEFAULT_BASE = "http://localhost:11434"

// Ollama's /api/chat and /api/tags endpoints.
// If the caller already appended /api to the base URL, skip the prefix.
function buildURL(base: string, path: string): string {
  const b = base.replace(/\/+$/, "")
  if (b.endsWith("/api")) return b + path.replace(/^\/api/, "")
  return b + "/api" + path
}

function buildHeaders(apiKey: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" }
  if (apiKey.trim()) h["Authorization"] = apiKey
  return h
}

// Ollama tool call arguments must be objects, not JSON strings.
function parseArgsToObject(args: string | undefined): Record<string, unknown> {
  if (!args) return {}
  try { return JSON.parse(args) } catch { return {} }
}

// Ollama tool call arguments in responses are objects; OpenAI expects JSON strings.
function stringifyArgs(raw: unknown): string {
  if (raw === null || raw === undefined) return "{}"
  if (typeof raw === "string") return raw.trim() || "{}"
  try { return JSON.stringify(raw) } catch { return "{}" }
}

function extractImagesFromContent(content: string | Array<{ type: string; image_url?: { url: string } }> | undefined): string[] | undefined {
  if (!content || typeof content === "string") return undefined
  const images: string[] = []
  for (const part of content) {
    if (part.type === "image_url" && part.image_url?.url) {
      const image = parseImageDataUrl(part.image_url.url)
      if (image) images.push(image.base64)
    }
  }
  return images.length > 0 ? images : undefined
}

function sanitizeMessages(messages: Message[]): unknown[] {
  // Track tool_call_id → name so tool result messages can include tool_name.
  const toolCallNames = new Map<string, string>()

  return messages.map((msg) => {
    const { parts, reasoning_content, ...rest } = msg

    if (rest.tool_calls?.length) {
      for (const tc of rest.tool_calls) {
        if (tc.id && tc.function.name) toolCallNames.set(tc.id, tc.function.name)
      }
      return {
        role: rest.role,
        content: contentToText(rest.content),
        tool_calls: rest.tool_calls
          .filter((tc) => tc.function.name)
          .map((tc) => ({
            type: "function",
            function: {
              name: tc.function.name,
              arguments: parseArgsToObject(tc.function.arguments),
            },
          })),
      }
    }

    if (rest.role === "tool") {
      const toolName = rest.tool_call_id ? (toolCallNames.get(rest.tool_call_id) ?? undefined) : undefined
      return {
        role: "tool",
        content: contentToText(rest.content),
        ...(toolName ? { tool_name: toolName } : {}),
      }
    }

    const images = extractImagesFromContent(rest.content)
    const result: Record<string, unknown> = { role: rest.role, content: contentToText(rest.content) }
    if (images) result.images = images
    return result
  })
}

function buildBody(req: CompletionRequest, model: string, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: sanitizeMessages(req.messages),
    stream,
  }
  if (req.tools?.length) body["tools"] = req.tools

  const options: Record<string, unknown> = {}
  if (req.temperature !== undefined) options["temperature"] = req.temperature
  if (req.max_tokens !== undefined) options["num_predict"] = req.max_tokens
  if (Object.keys(options).length) body["options"] = options

  return body
}

function usageFromResp(resp: Record<string, unknown>): Usage {
  const prompt = (resp["prompt_eval_count"] as number) ?? 0
  const completion = (resp["eval_count"] as number) ?? 0
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion }
}

function toolCallsFromResp(rawToolCalls: unknown[] | undefined): ToolCall[] | undefined {
  if (!rawToolCalls?.length) return undefined
  const calls = rawToolCalls
    .filter((tc: any) => tc?.function?.name)
    .map((tc: any, idx) => ({
      id: tc.id ?? `call_ollama_${idx}`,
      index: idx,
      type: "function" as const,
      function: { name: tc.function.name as string, arguments: stringifyArgs(tc.function.arguments) },
    }))
  return calls.length ? calls : undefined
}

function ollamaLineToChunk(resp: Record<string, unknown>): Chunk {
  const message = (resp["message"] as Record<string, unknown>) ?? {}
  const isDone = resp["done"] === true
  const toolCalls = isDone ? toolCallsFromResp(message["tool_calls"] as unknown[] | undefined) : undefined

  let finishReason: string | undefined
  if (isDone) {
    finishReason = (resp["done_reason"] as string) ?? "stop"
    if (toolCalls?.length) finishReason = "tool_calls"
  }

  return {
    delta: {
      content: typeof message["content"] === "string" && message["content"] ? message["content"] : undefined,
    },
    tool_calls: toolCalls,
    finish_reason: finishReason,
    usage: isDone ? usageFromResp(resp) : undefined,
  }
}

export const layer = (input: { apiKey: string; baseURL?: string; model?: string }) =>
  Layer.effect(
    Provider,
    Effect.gen(function* () {
      const base = input.baseURL ?? DEFAULT_BASE
      const defaultModel = input.model ?? "llama3.2"
      const chatURL = buildURL(base, "/chat")
      const tagsURL = buildURL(base, "/tags")
      const hdrs = buildHeaders(input.apiKey)

      const complete = (req: CompletionRequest): Effect.Effect<CompletionResult> =>
        Effect.gen(function* () {
          const model = req.model || defaultModel
          const res = yield* Effect.promise(() =>
            fetch(chatURL, {
              method: "POST",
              headers: hdrs,
              body: JSON.stringify(buildBody(req, model, false)),
              signal: req.signal,
            })
          )
          if (!res.ok) {
            const text = yield* Effect.promise(() => res.text())
            return yield* Effect.die(new Error(`Ollama error ${res.status}: ${text}`))
          }
          const json = (yield* Effect.promise(() => res.json())) as Record<string, unknown>
          const message = (json["message"] as Record<string, unknown>) ?? {}
          const toolCalls = toolCallsFromResp(message["tool_calls"] as unknown[] | undefined)
          return {
            id: `chatcmpl-ollama-${Date.now()}`,
            model: (json["model"] as string) ?? model,
            message: createAssistantMessage({
              content: typeof message["content"] === "string" ? message["content"] : undefined,
              tool_calls: toolCalls,
            }),
            usage: usageFromResp(json),
          } satisfies CompletionResult
        }).pipe(Effect.orDie)

      const stream = (req: CompletionRequest): Effect.Effect<ReadableStream<Chunk>> =>
        Effect.gen(function* () {
          const model = req.model || defaultModel
          const res = yield* Effect.promise(() =>
            fetch(chatURL, {
              method: "POST",
              headers: hdrs,
              body: JSON.stringify(buildBody(req, model, true)),
              signal: req.signal,
            })
          )
          if (!res.ok) {
            const text = yield* Effect.promise(() => res.text())
            return yield* Effect.die(new Error(`Ollama error ${res.status}: ${text}`))
          }
          const resBody = res.body
          if (!resBody) return yield* Effect.die(new Error("No response body"))

          const reader = resBody.getReader()
          const decoder = new TextDecoder()
          let buffer = ""

          return new ReadableStream<Chunk>({
            async pull(controller) {
              while (true) {
                const { done, value } = await reader.read()
                const lines = (buffer + (done ? "" : decoder.decode(value, { stream: true }))).split("\n")
                buffer = done ? "" : (lines.pop() ?? "")
                for (const line of lines) {
                  const trimmed = line.trim()
                  if (!trimmed) continue
                  try { controller.enqueue(ollamaLineToChunk(JSON.parse(trimmed))) } catch { /* skip unparseable */ }
                }
                if (done) {
                  try { controller.close() } catch { /* already closed */ }
                  return
                }
              }
            },
            cancel() { reader.cancel() },
          })
        }).pipe(Effect.orDie)

      const models = (): Effect.Effect<{ id: string }[]> =>
        Effect.gen(function* () {
          const res = yield* Effect.promise(() => fetch(tagsURL, { headers: hdrs }))
          const json = (yield* Effect.promise(() => res.json())) as Record<string, unknown>
          return ((json["models"] as any[]) ?? []).map((m: any) => ({ id: (m.name ?? m.id) as string }))
        }).pipe(Effect.orDie)

      return { complete, stream, models }
    }).pipe(Effect.orDie),
  )

export const def: ProviderDef = {
  id: "ollama",
  name: "Ollama",
  defaultModel: "llama3.2",
  authOptional: true,
  factory: (cfg) => layer({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, model: cfg.model }),
}
