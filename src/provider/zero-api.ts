import { Effect, Layer } from "effect"
import { Provider, type Chunk, type CompletionRequest, type CompletionResult, type ModelInfo, type ToolCall, type Usage } from "./types"
import { createAssistantMessage } from "./message-parts"
import type { ProviderDef } from "./registry"
import { modelSupportsVision } from "./models"
// Zero-API streams using the OpenAI Responses API SSE format,
// but non-streaming responses use the standard Chat Completions format.

const DEFAULT_BASE = "http://localhost:8081/v1"

// SSE parser that correctly joins multiple data: lines (per SSE spec).
// Multi-line data is joined with "" (no separator) because JSON may be split
// across multiple data: lines by some SSE implementations.
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
  flush()
  return messages
}

function usageFromResponses(usage: any): Usage {
  const prompt = usage?.input_tokens ?? usage?.prompt_tokens ?? 0
  const completion = usage?.output_tokens ?? usage?.completion_tokens ?? 0
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: usage?.total_tokens ?? prompt + completion,
    cached_tokens: usage?.input_tokens_details?.cached_tokens ?? usage?.prompt_tokens_details?.cached_tokens ?? 0,
  }
}

function usageFromChatCompletion(usage: any): Usage {
  const prompt = usage?.prompt_tokens ?? 0
  const completion = usage?.completion_tokens ?? 0
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: usage?.total_tokens ?? prompt + completion,
    cached_tokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
  }
}

function responseToolCallFromItem(item: any, index = 0): ToolCall {
  return {
    id: item.call_id ?? item.id ?? `call_${index}`,
    index,
    type: "function",
    function: { name: item.name, arguments: item.arguments },
  }
}

function responseTextFromOutputItem(item: any): string {
  if (item?.type !== "message" || !Array.isArray(item.content)) return ""
  return item.content
    .map((part: any) => {
      if (typeof part?.text === "string") return part.text
      if (typeof part?.refusal === "string") return part.refusal
      return ""
    })
    .join("")
}

function responseTextFromResponse(response: any): string {
  if (typeof response?.output_text === "string") return response.output_text
  if (!Array.isArray(response?.output)) return ""
  return response.output.map(responseTextFromOutputItem).join("")
}

function isTextContentPart(part: any): boolean {
  return typeof part?.text === "string"
}

function isImageContentPart(part: any): boolean {
  if (!part || typeof part !== "object") return false
  if (part.type === "image_url" && part.image_url?.url) return true
  if (part.type === "input_image" && (part.image_url || part.file_id || part.image_file || part.detail)) return true
  return false
}

function contentPartsText(content: any): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .filter(isTextContentPart)
    .map((part) => part.text)
    .join("\n")
}

function hasImageContentParts(content: any): boolean {
  return Array.isArray(content) && content.some(isImageContentPart)
}

function stripImageContent(message: any) {
  if (!hasImageContentParts(message.content)) return message
  if (!Array.isArray(message.content)) return message

  const content = message.content.filter((part: any) => !isImageContentPart(part))
  if (message.role === "tool") return { ...message, content: contentPartsText(content) }
  return { ...message, content }
}

function sanitizeMessages(messages: CompletionRequest["messages"], model: string) {
  const supportsVision = modelSupportsVision(model)
  return messages.flatMap(({ parts, ...rest }: any) => {
    if (!supportsVision) {
      return [stripImageContent(rest)]
    }

    // OpenAI-compatible chat APIs generally accept image_url parts only on
    // user messages. Tool outputs in OpenZeroCode can contain screenshots or
    // analyze_image attachments, so keep the tool result text as the required
    // tool message and immediately follow it with a user multimodal message
    // carrying the same image parts. This lets Zero-API forward the image to
    // vision-capable upstream models during the normal conversation turn.
    if (rest.role === "tool" && hasImageContentParts(rest.content)) {
      const text = contentPartsText(rest.content) || (typeof rest.content === "string" ? rest.content : "")
      return [
        { ...rest, content: text },
        {
          role: "user",
          content: [
            { type: "text", text: "The previous tool result included these image attachment(s). Analyze them directly as part of the conversation." },
            ...rest.content.filter((part: any) => part?.type === "image_url" && part.image_url?.url),
          ],
        },
      ]
    }

    return [rest]
  })
}

/** Timeout for a single reader.read() call before we consider the stream stuck. */
const STREAM_READ_TIMEOUT_MS = 60_000

function readWithTimeout(reader: ReadableStreamDefaultReader<Uint8Array>, signal?: AbortSignal): Promise<{ done: boolean; value?: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Stream read timeout"))
    }, STREAM_READ_TIMEOUT_MS)

    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error("Aborted"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })

    reader.read().then(
      (result) => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
        resolve(result)
      },
      (err) => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
        reject(err)
      }
    )
  })
}

export const layer = (input: { apiKey: string; baseURL?: string; model?: string }) =>
  Layer.effect(
    Provider,
    Effect.gen(function* () {
      const baseURL = (input.baseURL ?? DEFAULT_BASE).replace(/\/$/, "")
      const defaultModel = input.model ?? "openaicodex/gpt-5.4"

      const headers = () => ({
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      })

      const complete = (req: CompletionRequest): Effect.Effect<CompletionResult> =>
        Effect.gen(function* () {
          const model = req.model || defaultModel
          // Strip non-wire fields (max_tokens duplicated below if needed; signal is local-only).
          const { max_tokens, signal, ...rest } = req as any
          const body = { ...rest, messages: sanitizeMessages(req.messages, model), model, stream: false }

          const res = yield* Effect.promise(() =>
            fetch(`${baseURL}/chat/completions`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal })
          )
          if (!res.ok) {
            const text = yield* Effect.promise(() => res.text())
            return yield* Effect.die(new Error(`Zero-API error ${res.status}: ${text}`))
          }
          const json = yield* Effect.promise(() => res.json()) as Effect.Effect<any>
          const choice = json.choices?.[0]

          return {
            id: json.id ?? `zero_${Date.now()}`,
            model: json.model ?? model,
            message: createAssistantMessage({
              content: choice?.message?.content ?? undefined,
              reasoning_content: choice?.message?.reasoning_content ?? undefined,
              tool_calls: choice?.message?.tool_calls,
            }),
            usage: usageFromChatCompletion(json.usage) ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cached_tokens: 0 },
          } satisfies CompletionResult
        }).pipe(Effect.orDie)

      const stream = (req: CompletionRequest): Effect.Effect<ReadableStream<Chunk>> =>
        Effect.gen(function* () {
          const model = req.model || defaultModel
          const { max_tokens, signal, ...rest } = req as any
          const body = { ...rest, messages: sanitizeMessages(req.messages, model), model, stream: true }

          const res = yield* Effect.promise(() =>
            fetch(`${baseURL}/chat/completions`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal })
          )
          if (!res.ok) {
            const text = yield* Effect.promise(() => res.text())
            return yield* Effect.die(new Error(`Zero-API error ${res.status}: ${text}`))
          }
          const body2 = res.body
          if (!body2) return yield* Effect.die(new Error("No response body"))

          const reader = body2.getReader() as ReadableStreamDefaultReader<Uint8Array>
          const decoder = new TextDecoder()
          let buffer = ""
          let emittedText = false
          let hasToolCalls = false
          let streamDone = false

          return new ReadableStream<Chunk>({
            async pull(controller) {
              if (streamDone) return
              while (true) {
                if (signal?.aborted) {
                  const err = new Error("Aborted")
                  try { await reader.cancel(err) } catch {}
                  controller.error(err)
                  return
                }
                let done: boolean
                let value: Uint8Array | undefined
                try {
                  const result = await readWithTimeout(reader, signal)
                  done = result.done
                  value = result.value
                } catch (err) {
                  // Timeout or abort — cancel the underlying reader and surface
                  // the failure to consumers instead of ending silently.
                  try { await reader.cancel(err) } catch {}
                  if (buffer) {
                    for (const part of buffer.split("\n\n")) {
                      if (!part) continue
                      for (const msg of parseSSE(part)) {
                        let raw: any
                        try { raw = JSON.parse(msg.data) } catch { continue }
                        const type: string = raw.type ?? msg.event ?? ""
                        if (type === "response.completed" || type === "response.incomplete") {
                          const text = !emittedText ? responseTextFromResponse(raw.response) : ""
                          if (text) {
                            emittedText = true
                            try { controller.enqueue({ delta: { content: text } }) } catch {}
                          }
                          if (Array.isArray(raw.response?.output) && raw.response.output.some((item: any) => item?.type === "function_call")) hasToolCalls = true
                          const finishReason = hasToolCalls ? "tool_calls" : (type === "response.completed" ? "stop" : "length")
                          try { controller.enqueue({ delta: {}, finish_reason: finishReason, usage: usageFromResponses(raw.response?.usage) }) } catch {}
                        }
                      }
                    }
                  }
                  try { controller.error(err) } catch {}
                  return
                }
                if (done) {
                  streamDone = true
                  // Flush remaining buffer on clean end-of-stream
                  if (buffer) {
                    for (const part of buffer.split("\n\n")) {
                      if (!part) continue
                      for (const msg of parseSSE(part)) {
                        let raw: any
                        try { raw = JSON.parse(msg.data) } catch { continue }
                        const type: string = raw.type ?? msg.event ?? ""
                        if (type === "response.completed" || type === "response.incomplete") {
                          const text = !emittedText ? responseTextFromResponse(raw.response) : ""
                          if (text) {
                            emittedText = true
                            try { controller.enqueue({ delta: { content: text } }) } catch {}
                          }
                          if (Array.isArray(raw.response?.output) && raw.response.output.some((item: any) => item?.type === "function_call")) hasToolCalls = true
                          const finishReason = hasToolCalls ? "tool_calls" : (type === "response.completed" ? "stop" : "length")
                          try { controller.enqueue({ delta: {}, finish_reason: finishReason, usage: usageFromResponses(raw.response?.usage) }) } catch {}
                        }
                      }
                    }
                    buffer = ""
                  }
                  try { controller.close() } catch {}
                  return
                }
                buffer += decoder.decode(value, { stream: true })
                const parts = buffer.split("\n\n")
                buffer = parts.pop() ?? ""
                for (const part of parts) {
                  if (!part) continue
                  for (const msg of parseSSE(part)) {
                    let raw: any
                    try { raw = JSON.parse(msg.data) } catch { continue }
                    const type: string = raw.type ?? msg.event ?? ""

                    if (type === "response.output_text.delta" || type === "response.refusal.delta") {
                      if (raw.delta) emittedText = true
                      controller.enqueue({ delta: { content: raw.delta ?? "" } })
                    } else if (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") {
                      controller.enqueue({ delta: { reasoning_content: raw.delta ?? "" } })
                    } else if (type === "response.output_item.added" && raw.item?.type === "function_call") {
                      hasToolCalls = true
                      controller.enqueue({ delta: {}, tool_calls: [responseToolCallFromItem(raw.item, raw.output_index ?? 0)] })
                    } else if (type === "response.function_call_arguments.delta") {
                      controller.enqueue({ delta: {}, tool_calls: [{ id: raw.call_id, index: raw.output_index ?? 0, type: "function", function: { arguments: raw.delta ?? "" } }] })
                    } else if (type === "response.output_item.done" && raw.item?.type === "function_call") {
                      hasToolCalls = true
                      controller.enqueue({ delta: {}, tool_calls: [responseToolCallFromItem(raw.item, raw.output_index ?? 0)] })
                    } else if (type === "response.output_item.done" && raw.item?.type === "message" && !emittedText) {
                      const text = responseTextFromOutputItem(raw.item)
                      if (text) {
                        emittedText = true
                        controller.enqueue({ delta: { content: text } })
                      }
                    } else if (type === "response.completed") {
                      const text = !emittedText ? responseTextFromResponse(raw.response) : ""
                      if (text) {
                        emittedText = true
                        controller.enqueue({ delta: { content: text } })
                      }
                      if (Array.isArray(raw.response?.output) && raw.response.output.some((item: any) => item?.type === "function_call")) hasToolCalls = true
                      controller.enqueue({ delta: {}, finish_reason: hasToolCalls ? "tool_calls" : "stop", usage: usageFromResponses(raw.response?.usage) })
                    } else if (type === "response.incomplete") {
                      const text = !emittedText ? responseTextFromResponse(raw.response) : ""
                      if (text) {
                        emittedText = true
                        controller.enqueue({ delta: { content: text } })
                      }
                      controller.enqueue({ delta: {}, finish_reason: "length", usage: usageFromResponses(raw.response?.usage) })
                    } else if (raw.choices) {
                      const delta = raw.choices[0]?.delta ?? {}
                      const finish = raw.choices[0]?.finish_reason
                      const chunk: Chunk = {
                        delta: { content: delta.content ?? undefined, reasoning_content: delta.reasoning_content ?? undefined },
                        finish_reason: finish ?? undefined,
                        usage: raw.usage ? usageFromChatCompletion(raw.usage) : undefined,
                      }
                      if (delta.tool_calls) chunk.tool_calls = delta.tool_calls
                      controller.enqueue(chunk)
                    }
                  }
                }
              }
            },
            cancel() { reader.cancel() },
          })
        }).pipe(Effect.orDie)

      const models = () =>
        Effect.gen(function* () {
          const res = yield* Effect.promise(() =>
            fetch(`${baseURL}/models`, { headers: headers() })
          )
          const json = yield* Effect.promise(() => res.json()) as Effect.Effect<any>
          return (json.data ?? []).map((m: any) => ({
            id: m.id,
            contextLimit: typeof m.context_window === "number" ? m.context_window : undefined,
            pricing:
              typeof m.input_price === "number" && typeof m.output_price === "number"
                ? { input: m.input_price, output: m.output_price }
                : undefined,
          } satisfies ModelInfo)) as ModelInfo[]
        }).pipe(Effect.orDie)

      return { complete, stream, models }
    }).pipe(Effect.orDie),
  )

export const def: ProviderDef = {
  id: "zero-api",
  name: "Zero-API",
  defaultModel: "openaicodex/gpt-5.4",
  envKeys: ["ZERO_API_KEY"],
  factory: (cfg) => layer({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL ?? DEFAULT_BASE,
    model: cfg.model,
  }),
}
