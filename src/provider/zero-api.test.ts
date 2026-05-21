import { describe, it } from "node:test"
import assert from "node:assert"
import { Effect } from "effect"
import { Provider, type ToolDef } from "./types"
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
