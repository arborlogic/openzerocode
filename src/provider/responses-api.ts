import type { Chunk, CompletionRequest, CompletionResult, Message, ToolCall, ToolDef, Usage } from "./types"
import { createAssistantMessage } from "./message-parts"
import { contentToText } from "./content"

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

/**
 * Timeout for a single reader.read() call before we consider the stream stuck.
 * Vision tool results and reasoning models can legitimately take more than a
 * minute before their next SSE event, especially before the first token.
 */
export const STREAM_READ_TIMEOUT_MS = 180_000

// SSE parser that correctly joins multiple data: lines (per SSE spec).
export function parseSSE(text: string): { data: string; event?: string }[] {
  const messages: { data: string; event?: string }[] = []
  let event = ""
  const dataLines: string[] = []

  const flush = () => {
    const data = dataLines.join("")
    dataLines.length = 0
    if (!data || data === "[DONE]") {
      event = ""
      return
    }
    try {
      JSON.parse(data)
    } catch {
      event = ""
      return
    }
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

export function usageFromResponses(usage: ResponseUsage | undefined): Usage {
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

export function responseToolCall(item: ResponseOutputItem, index = 0): ToolCall {
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

export function responseToCompletion(raw: any, model: string, idPrefix = "responses"): CompletionResult {
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
    .map((item, index) => (item.type === "function_call" ? responseToolCall(item, index) : undefined))
    .filter((item): item is ToolCall => Boolean(item))

  return {
    id: raw.id ?? `${idPrefix}_${Date.now()}`,
    model: raw.model ?? model,
    message: createAssistantMessage({
      content: content || undefined,
      reasoning_content: reasoning || undefined,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
    }),
    usage: usageFromResponses(raw.usage),
  }
}

export function splitInstructions(messages: Message[]) {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => contentToText(message.content))
    .filter(Boolean)
    .join("\n")
  return {
    instructions: instructions || "You are a helpful coding assistant.",
    messages: messages.filter((message) => message.role !== "system"),
  }
}

function contentPartsToResponses(content: Message["content"], role: Message["role"]): Array<Record<string, unknown>> {
  if (Array.isArray(content)) {
    const parts: Array<Record<string, unknown>> = []
    for (const part of content) {
      if (part.type === "text") {
        parts.push({
          type: role === "assistant" ? "output_text" : "input_text",
          text: part.text,
        })
        continue
      }
      if (part.type === "image_url" && part.image_url?.url) {
        parts.push({
          type: "input_image",
          image_url: part.image_url.url,
        })
      }
    }
    return parts
  }
  return [{
    type: role === "assistant" ? "output_text" : "input_text",
    text: content ?? "",
  }]
}

function imagePartsFromContent(content: Message["content"]): Array<{ type: "input_image"; image_url: string }> {
  if (!Array.isArray(content)) return []
  return content
    .filter((part): part is { type: "image_url"; image_url: { url: string } } =>
      part.type === "image_url" && typeof part.image_url?.url === "string" && part.image_url.url.length > 0,
    )
    .map((part) => ({
      type: "input_image" as const,
      image_url: part.image_url.url,
    }))
}

export function messagesToInput(messages: Message[]) {
  const input: any[] = []
  for (const message of messages) {
    if (message.role === "tool") {
      // Responses APIs only accept string function_call_output. Tool results in
      // OpenZeroCode can include screenshots/analyze_image attachments, so keep
      // the required text output and immediately follow with a user multimodal
      // message carrying the same image parts for vision-capable models.
      const text = contentToText(message.content)
      input.push({
        type: "function_call_output",
        call_id: message.tool_call_id,
        output: text,
      })
      const images = imagePartsFromContent(message.content)
      if (images.length > 0) {
        input.push({
          role: "user",
          content: [
            {
              type: "input_text",
              text: "The previous tool result included these image attachment(s). Analyze them directly as part of the conversation.",
            },
            ...images,
          ],
        })
      }
      continue
    }

    if (message.role === "assistant") {
      if (message.content) {
        input.push({
          role: "assistant",
          content: contentPartsToResponses(message.content, "assistant"),
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
      content: contentPartsToResponses(message.content, message.role),
    })
  }
  return input
}

export function toolsToResponsesTools(tools: ToolDef[] | undefined) {
  return tools?.map((tool) => ({
    type: "function",
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }))
}

export function toResponsesRequestBody(req: CompletionRequest) {
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

export function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<{ done: boolean; value?: Uint8Array }> {
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
      },
    )
  })
}

export function createResponsesStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): ReadableStream<Chunk> {
  const reader = body.getReader() as ReadableStreamDefaultReader<Uint8Array>
  const decoder = new TextDecoder()
  let buffer = ""
  const argumentDeltas = new Set<number>()
  let streamDone = false

  return new ReadableStream<Chunk>({
    async pull(controller) {
      if (streamDone) return
      while (true) {
        if (signal?.aborted) {
          const err = new Error("Aborted")
          try {
            await reader.cancel(err)
          } catch {}
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
          try {
            await reader.cancel(err)
          } catch {}
          if (buffer) {
            for (const part of buffer.split("\n\n")) {
              if (!part) continue
              for (const msg of parseSSE(part)) {
                let raw: any
                try {
                  raw = JSON.parse(msg.data)
                } catch {
                  continue
                }
                const type = raw.type as string | undefined
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
                  streamDone = true
                } else if (type === "response.incomplete") {
                  controller.enqueue({ delta: {}, finish_reason: "length", usage: usageFromResponses(raw.response?.usage) })
                  streamDone = true
                }
              }
            }
          }
          // A terminal Responses event is the logical end of the response even
          // when an HTTP proxy keeps the SSE socket open. Do not turn a
          // successfully completed response into a read-timeout error.
          if (streamDone) {
            void reader.cancel().catch(() => {})
            controller.close()
            return
          }
          controller.error(err)
          return
        }

        if (done) {
          streamDone = true
          controller.close()
          return
        }

        buffer += decoder.decode(value, { stream: true })
        // SSE allows CRLF and bare CR line endings. Normalize before splitting
        // events so terminal responses are not stranded in the buffer while a
        // keep-alive transport remains open.
        buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
        const parts = buffer.split("\n\n")
        buffer = parts.pop() ?? ""
        for (const part of parts) {
          if (!part) continue
          for (const msg of parseSSE(part)) {
            let raw: any
            try {
              raw = JSON.parse(msg.data)
            } catch {
              continue
            }
            const type = raw.type as string | undefined
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
              streamDone = true
            } else if (type === "response.incomplete") {
              controller.enqueue({ delta: {}, finish_reason: "length", usage: usageFromResponses(raw.response?.usage) })
              streamDone = true
            }
          }
          if (streamDone) {
            void reader.cancel().catch(() => {})
            controller.close()
            return
          }
        }
      }
    },
    cancel() {
      reader.cancel()
    },
  })
}
