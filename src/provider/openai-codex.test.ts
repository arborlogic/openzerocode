import { describe, it } from "node:test"
import assert from "node:assert"
import { Effect } from "effect"
import { collectCodexCompletion, layer, toCodexRequestBody } from "./openai-codex"
import { Provider } from "./types"

describe("openai codex provider", () => {
  it("advertises the current Codex models without deprecated GPT-5.2–5.4 entries", async () => {
    const models = await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* Provider
        return yield* provider.models()
      }).pipe(Effect.provide(layer({}))),
    )

    assert.deepEqual(models.map(({ id }) => id), [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
    ])
  })

  it("moves system messages into required instructions", () => {
    const body = toCodexRequestBody({
      model: "gpt-5.4",
      messages: [
        { role: "system", content: "You are a helpful coding assistant." },
        { role: "user", content: "hello" },
      ],
      stream: true,
    })

    assert.equal(body.instructions, "You are a helpful coding assistant.")
    assert.deepEqual(body.input, [
      { role: "user", content: [{ type: "input_text", text: "hello" }] },
    ])
  })

  it("uses fallback instructions and streaming for non-streaming callers", () => {
    const body = toCodexRequestBody({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    })

    assert.equal(body.instructions, "You are a helpful coding assistant.")
    assert.equal(body.stream, true)
  })

  it("omits unsupported temperature from Codex requests", () => {
    const body = toCodexRequestBody({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
      temperature: 0,
    })

    assert.equal(Object.hasOwn(body, "temperature"), false)
  })

  it("omits unsupported max_output_tokens from Codex requests", () => {
    const body = toCodexRequestBody({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
      max_tokens: 1_024,
    })

    assert.equal(Object.hasOwn(body, "max_output_tokens"), false)
  })

  it("forwards reasoning effort using the Codex Responses shape", () => {
    const body = toCodexRequestBody({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "solve this" }],
      stream: true,
      reasoning_effort: "high",
    })

    assert.deepEqual(body.reasoning, { effort: "high", summary: "auto", context: "all_turns" })
  })

  it("forwards every GPT-5.6 advanced reasoning effort unchanged", () => {
    for (const effort of ["xhigh", "max"] as const) {
      const body = toCodexRequestBody({
        model: "gpt-5.6-sol",
        messages: [{ role: "user", content: "solve this" }],
        stream: true,
        reasoning_effort: effort,
      })

      assert.deepEqual(body.reasoning, { effort, summary: "auto", context: "all_turns" })
    }
  })

  it("collects a streaming Codex response for complete callers", async () => {
    const encoder = new TextEncoder()
    const response = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          "event: response.output_text.delta\n",
          "data: {\"type\":\"response.output_text.delta\",\"delta\":\"summary\"}\n\n",
          "event: response.completed\n",
          "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":2,\"output_tokens\":1,\"total_tokens\":3}}}\n\n",
        ].join("")))
        controller.close()
      },
    })

    const result = await collectCodexCompletion(
      // Use the same parser as the provider's `complete()` implementation.
      (await import("./responses-api")).createResponsesStream(response),
      "gpt-5.4",
    )

    assert.equal(result.message.content, "summary")
    assert.deepEqual(result.usage, { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3, cached_tokens: 0 })
  })
})
