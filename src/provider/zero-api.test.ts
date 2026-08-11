import { describe, it } from "node:test"
import assert from "node:assert"
import { Effect } from "effect"
import { Provider, type Interface, type ToolDef } from "./types"
import { layer } from "./zero-api"

// Integration test: hits the live Zero API. Skip the whole suite when the
// env var is missing so it doesn't break local / CI runs that don't have a key.
const API_KEY = process.env.ZERO_API_KEY
const describeIfKey = API_KEY ? describe : describe.skip

const testLayer = layer({ apiKey: API_KEY ?? "" })

const BASH_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "bash",
    description: "Run shell commands",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
}

describe("zero-api provider request serialization", () => {
  async function captureCompleteRequest(req: Parameters<Interface["complete"]>[0]) {
    const originalFetch = globalThis.fetch
    let requestBody: any
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({
        id: "chatcmpl_test",
        model: req.model,
        choices: [{ message: { role: "assistant", content: "seen" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    }) as typeof fetch

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const p = yield* Provider
          return yield* p.complete(req)
        }).pipe(Effect.provide(layer({ apiKey: "test", baseURL: "http://zero.test/v1" })))
      )
    } finally {
      globalThis.fetch = originalFetch
    }
    return requestBody
  }

  it("preserves multimodal image content in non-streaming chat completions", async () => {
    const requestBody = await captureCompleteRequest({
      model: "openaicodex/gpt-5.5",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "what is in this image?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAECAw==" } },
        ],
      }],
      stream: false,
    })

    assert.equal(requestBody.model, "openaicodex/gpt-5.5")
    assert.equal(requestBody.stream, false)
    assert.deepEqual(requestBody.messages[0].content, [
      { type: "text", text: "what is in this image?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAECAw==" } },
    ])
  })

  it("serializes reasoning effort and token controls", async () => {
    const requestBody = await captureCompleteRequest({
      model: "openaicodex/gpt-5.6-terra",
      messages: [{ role: "user", content: "solve this" }],
      stream: false,
      max_tokens: 4096,
      temperature: 0.2,
      reasoning_effort: "high",
    })

    assert.equal(requestBody.max_tokens, 4096)
    assert.equal(requestBody.temperature, 0.2)
    assert.equal(requestBody.reasoning_effort, "high")
  })

  it("strips image content for non-vision models after local VLM fallback text remains", async () => {
    const requestBody = await captureCompleteRequest({
      model: "some-text-model",
      messages: [{
        role: "tool",
        tool_call_id: "call_img",
        content: [
          { type: "text", text: "Local VLM analysis: button is visible" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAECAw==" } },
        ],
        parts: [
          { type: "tool-result", id: "call_img", tool: "browser_observe_visual", output: "Local VLM analysis: button is visible" },
          { type: "image", mimeType: "image/png", base64: "AAECAw==" },
        ],
      }],
      stream: false,
    })

    assert.equal(requestBody.model, "some-text-model")
    assert.deepEqual(requestBody.messages, [{
      role: "tool",
      tool_call_id: "call_img",
      content: "Local VLM analysis: button is visible",
    }])
  })

  it("strips only image parts for non-vision user messages", async () => {
    const requestBody = await captureCompleteRequest({
      model: "some-text-model",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "plain text" },
          { type: "input_text", text: "responses text" },
          { type: "custom_text", text: "custom text" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAECAw==" } },
          { type: "input_image", image_url: "data:image/png;base64,BAUGBw==" },
        ] as any,
      }],
      stream: false,
    })

    assert.equal(requestBody.model, "some-text-model")
    assert.deepEqual(requestBody.messages, [{
      role: "user",
      content: [
        { type: "text", text: "plain text" },
        { type: "input_text", text: "responses text" },
        { type: "custom_text", text: "custom text" },
      ],
    }])
  })

  it("moves tool image attachments into a follow-up user multimodal message", async () => {
    const requestBody = await captureCompleteRequest({
      model: "openaicodex/gpt-5.5",
      messages: [{
        role: "tool",
        tool_call_id: "call_img",
        content: [
          { type: "text", text: "Screenshot captured" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAECAw==" } },
        ],
        parts: [
          { type: "tool-result", id: "call_img", tool: "browser_screenshot", output: "Screenshot captured" },
          { type: "image", mimeType: "image/png", base64: "AAECAw==" },
        ],
      }],
      stream: false,
    })

    assert.equal(requestBody.messages.length, 2)
    assert.deepEqual(requestBody.messages[0], {
      role: "tool",
      tool_call_id: "call_img",
      content: "Screenshot captured",
    })
    assert.equal(requestBody.messages[1].role, "user")
    assert.deepEqual(requestBody.messages[1].content[1], {
      type: "image_url",
      image_url: { url: "data:image/png;base64,AAECAw==" },
    })
    assert.equal(requestBody.messages[1].parts, undefined)
  })

  it("preserves max_tokens in chat completion requests", async () => {
    const requestBody = await captureCompleteRequest({
      model: "openaicodex/gpt-5.5",
      messages: [{ role: "user", content: "say hi" }],
      stream: false,
      max_tokens: 400,
    })

    assert.equal(requestBody.max_tokens, 400)
    assert.equal(requestBody.model, "openaicodex/gpt-5.5")
    assert.equal(requestBody.stream, false)
  })

  it("streams refusal deltas as assistant text instead of dropping them", async () => {
    const originalFetch = globalThis.fetch
    const encoder = new TextEncoder()
    globalThis.fetch = (async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode([
            "event: response.refusal.delta",
            'data: {"type":"response.refusal.delta","delta":"I cannot do that."}',
            "",
            "event: response.completed",
            'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":2}}}',
            "",
          ].join("\n")))
          controller.close()
        },
      })
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    }) as unknown as typeof fetch

    try {
      const stream = await Effect.runPromise(
        Effect.gen(function* () {
          const p = yield* Provider
          return yield* p.stream({
            model: "openaicodex/gpt-5.5",
            messages: [{ role: "user", content: "review code" }],
            stream: true,
          })
        }).pipe(Effect.provide(layer({ apiKey: "test", baseURL: "http://zero.test/v1" })))
      )

      const reader = stream.getReader()
      const chunks: string[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.delta.content) chunks.push(value.delta.content)
      }

      assert.equal(chunks.join(""), "I cannot do that.")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("streams final response output text when no text delta was sent", async () => {
    const originalFetch = globalThis.fetch
    const encoder = new TextEncoder()
    globalThis.fetch = (async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode([
            "event: response.completed",
            'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Review result"}]}],"usage":{"input_tokens":1,"output_tokens":2}}}',
            "",
          ].join("\n")))
          controller.close()
        },
      })
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    }) as unknown as typeof fetch

    try {
      const stream = await Effect.runPromise(
        Effect.gen(function* () {
          const p = yield* Provider
          return yield* p.stream({
            model: "openaicodex/gpt-5.5",
            messages: [{ role: "user", content: "review code" }],
            stream: true,
          })
        }).pipe(Effect.provide(layer({ apiKey: "test", baseURL: "http://zero.test/v1" })))
      )

      const reader = stream.getReader()
      const chunks: string[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.delta.content) chunks.push(value.delta.content)
      }

      assert.equal(chunks.join(""), "Review result")
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("closes on response.completed without waiting for transport EOF", async () => {
    const originalFetch = globalThis.fetch
    const encoder = new TextEncoder()
    let transportCancelled = false
    globalThis.fetch = (async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode([
            "event: response.completed",
            'data: {"type":"response.completed","response":{"output":[{"type":"message","content":[{"type":"output_text","text":"Finished"}]}],"usage":{"input_tokens":1,"output_tokens":2}}}',
            "",
            "",
          ].join("\n")))
          // Deliberately do not close: a terminal SSE event must be sufficient.
        },
        cancel() {
          transportCancelled = true
        },
      })
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    }) as unknown as typeof fetch

    try {
      const stream = await Effect.runPromise(
        Effect.gen(function* () {
          const p = yield* Provider
          return yield* p.stream({
            model: "openaicodex/gpt-5.5",
            messages: [{ role: "user", content: "inspect image" }],
            stream: true,
          })
        }).pipe(Effect.provide(layer({ apiKey: "test", baseURL: "http://zero.test/v1" })))
      )

      const reader = stream.getReader()
      const chunks: any[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }

      assert.equal(chunks[0]?.delta.content, "Finished")
      assert.equal(chunks.at(-1)?.finish_reason, "stop")
      assert.equal(transportCancelled, true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("closes on a CRLF chat completion finish reason without waiting for transport EOF", async () => {
    const originalFetch = globalThis.fetch
    const encoder = new TextEncoder()
    let transportCancelled = false
    globalThis.fetch = (async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode([
            'data: {"choices":[{"delta":{"content":"Finished"},"finish_reason":null}]}',
            "",
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
            "",
            "",
          ].join("\r\n")))
          // Deliberately leave the transport open to emulate a keep-alive proxy.
        },
        cancel() {
          transportCancelled = true
        },
      })
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    }) as unknown as typeof fetch

    try {
      const stream = await Effect.runPromise(
        Effect.gen(function* () {
          const p = yield* Provider
          return yield* p.stream({
            model: "openaicodex/gpt-5.6-terra",
            messages: [{ role: "user", content: "say hi" }],
            stream: true,
          })
        }).pipe(Effect.provide(layer({ apiKey: "test", baseURL: "http://zero.test/v1" })))
      )

      const reader = stream.getReader()
      const first = await reader.read()
      const second = await reader.read()
      const third = await reader.read()

      assert.equal(first.value?.delta.content, "Finished")
      assert.equal(second.value?.finish_reason, "stop")
      assert.equal(third.done, true)
      assert.equal(transportCancelled, true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("streams final output item message text when no text delta was sent", async () => {
    const originalFetch = globalThis.fetch
    const encoder = new TextEncoder()
    globalThis.fetch = (async () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode([
            "event: response.output_item.done",
            'data: {"type":"response.output_item.done","item":{"type":"message","content":[{"type":"output_text","text":"Inline final text"}]}}',
            "",
            "event: response.completed",
            'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":2}}}',
            "",
          ].join("\n")))
          controller.close()
        },
      })
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
    }) as unknown as typeof fetch

    try {
      const stream = await Effect.runPromise(
        Effect.gen(function* () {
          const p = yield* Provider
          return yield* p.stream({
            model: "openaicodex/gpt-5.5",
            messages: [{ role: "user", content: "review code" }],
            stream: true,
          })
        }).pipe(Effect.provide(layer({ apiKey: "test", baseURL: "http://zero.test/v1" })))
      )

      const reader = stream.getReader()
      const chunks: string[] = []
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value.delta.content) chunks.push(value.delta.content)
      }

      assert.equal(chunks.join(""), "Inline final text")
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describeIfKey("zero-api provider", () => {
  it("models returns a list", async () => {
    const models = await Effect.runPromise(
      Effect.gen(function* () {
        const p = yield* Provider
        return yield* p.models()
      }).pipe(Effect.provide(testLayer))
    )
    assert.ok(Array.isArray(models), "models should be an array")
    assert.ok(models.length > 0, "models should not be empty")
  })

  it("complete returns a text response", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const p = yield* Provider
        return yield* p.complete({
          model: "openaicodex/gpt-5.4",
          messages: [{ role: "user", content: "say hi in one word" }],
          stream: false,
        })
      }).pipe(Effect.provide(testLayer))
    )
    assert.ok(result.message.content, "should have text content")
    assert.ok(result.usage.total_tokens > 0, "should have token usage")
  })

  it("stream returns text chunks", async () => {
    const stream = await Effect.runPromise(
      Effect.gen(function* () {
        const p = yield* Provider
        return yield* p.stream({
          model: "openaicodex/gpt-5.4",
          messages: [{ role: "user", content: "count 1 2 3" }],
          stream: true,
        })
      }).pipe(Effect.provide(testLayer))
    )
    const reader = stream.getReader()
    const chunks: string[] = []
    let usage
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.delta.content) chunks.push(value.delta.content)
      if (value.usage) usage = value.usage
    }
    const text = chunks.join("")
    assert.ok(text.length > 0, "should have text content")
    assert.ok(usage && usage.total_tokens > 0, "should have token usage")
  })

  it("complete triggers a tool call (non-streaming)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const p = yield* Provider
        return yield* p.complete({
          model: "openaicodex/gpt-5.4",
          messages: [
            { role: "system", content: "You MUST call the bash tool. Never respond with plain text." },
            { role: "user", content: "Run: echo hello" },
          ],
          tools: [BASH_TOOL],
          stream: false,
        })
      }).pipe(Effect.provide(testLayer))
    )
    assert.ok(result.message.tool_calls && result.message.tool_calls.length > 0,
      `expected tool_calls, got: ${JSON.stringify(result.message)}`)
    const call = result.message.tool_calls![0]
    assert.equal(call.function.name, "bash", `expected bash, got: ${call.function.name}`)
    assert.ok(call.function.arguments, "should have arguments")
    const args = JSON.parse(call.function.arguments!)
    assert.ok(args.command, `expected command in args, got: ${JSON.stringify(args)}`)
  })

  it("stream triggers a tool call (streaming)", async () => {
    const stream = await Effect.runPromise(
      Effect.gen(function* () {
        const p = yield* Provider
        return yield* p.stream({
          model: "openaicodex/gpt-5.4",
          messages: [
            { role: "system", content: "You MUST call the bash tool. Never respond with plain text." },
            { role: "user", content: "Run: echo hello" },
          ],
          tools: [BASH_TOOL],
          stream: true,
        })
      }).pipe(Effect.provide(testLayer))
    )

    const reader = stream.getReader()
    // Accumulate tool call deltas
    const toolCallMap: Record<number, { id?: string; name?: string; arguments: string }> = {}
    let finishReason: string | null | undefined
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.finish_reason) finishReason = value.finish_reason
      if (value.tool_calls) {
        for (const tc of value.tool_calls) {
          const idx = tc.index ?? 0
          if (!toolCallMap[idx]) toolCallMap[idx] = { arguments: "" }
          if (tc.id) toolCallMap[idx].id = tc.id
          if (tc.function.name) toolCallMap[idx].name = tc.function.name
          if (tc.function.arguments) toolCallMap[idx].arguments += tc.function.arguments
        }
      }
    }

    assert.equal(finishReason, "tool_calls", `expected finish_reason=tool_calls, got: ${finishReason}`)
    const calls = Object.values(toolCallMap)
    assert.ok(calls.length > 0, "should have at least one tool call")
    const call = calls[0]
    assert.equal(call.name, "bash", `expected bash, got: ${call.name}`)
    assert.ok(call.arguments, "should have accumulated arguments")
    const args = JSON.parse(call.arguments)
    assert.ok(args.command, `expected command in args, got: ${JSON.stringify(args)}`)
  })

  it("multi-turn: tool result triggers a second tool call", async () => {
    // Step 0: get tool call
    const step0 = await Effect.runPromise(
      Effect.gen(function* () {
        const p = yield* Provider
        return yield* p.complete({
          model: "openaicodex/gpt-5.4",
          messages: [
            { role: "system", content: "You are a helpful assistant. Use the bash tool to answer. Do not respond with plain text." },
            { role: "user", content: "First run: echo step1. Then after getting the result, run: echo step2." },
          ],
          tools: [BASH_TOOL],
          stream: false,
        })
      }).pipe(Effect.provide(testLayer))
    )

    assert.ok(step0.message.tool_calls && step0.message.tool_calls.length > 0,
      `step0 expected tool_calls, got: ${JSON.stringify(step0.message)}`)
    const call0 = step0.message.tool_calls![0]

    // Step 1: send back tool result, expect another tool call
    const step1 = await Effect.runPromise(
      Effect.gen(function* () {
        const p = yield* Provider
        return yield* p.complete({
          model: "openaicodex/gpt-5.4",
          messages: [
            { role: "system", content: "You are a helpful assistant. Use the bash tool to answer. Do not respond with plain text." },
            { role: "user", content: "First run: echo step1. Then after getting the result, run: echo step2." },
            step0.message,
            { role: "tool", tool_call_id: call0.id, content: "step1" },
          ],
          tools: [BASH_TOOL],
          stream: false,
        })
      }).pipe(Effect.provide(testLayer))
    )

    assert.ok(step1.message.tool_calls && step1.message.tool_calls.length > 0,
      `step1 expected second tool_call after receiving tool result, got: ${JSON.stringify(step1.message)}`)
    const call1 = step1.message.tool_calls![0]
    assert.equal(call1.function.name, "bash")
    const args1 = JSON.parse(call1.function.arguments ?? "{}")
    assert.ok(args1.command?.includes("step2"), `expected echo step2 command, got: ${JSON.stringify(args1)}`)
  })
})
