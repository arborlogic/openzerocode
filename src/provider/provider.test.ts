import { describe, it } from "node:test"
import assert from "node:assert"
import { Effect } from "effect"
import { Provider } from "./types"
import { layer } from "./big-pickle"

const API_KEY = process.env.OPENCODE_API ?? process.env.OPENCODE_API_KEY
if (!API_KEY) throw new Error("OPENCODE_API env var required")

const testLayer = layer({ apiKey: API_KEY })

describe("openapi provider", () => {
  it("models returns a list", async () => {
    const models = await Effect.runPromise(
      Effect.gen(function* () {
        const p = yield* Provider
        return yield* p.models()
      }).pipe(Effect.provide(testLayer))
    )
    assert.ok(models.length > 0)
    assert.ok(models.includes("big-pickle"))
  })

  it("complete returns a response", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const p = yield* Provider
        return yield* p.complete({
          model: "big-pickle",
          messages: [{ role: "user", content: "say hi in one word" }],
          stream: false,
        })
      }).pipe(Effect.provide(testLayer))
    )
    assert.ok(result.message.content)
    assert.ok(result.usage.total_tokens > 0)
  })

  it("stream returns chunks", async () => {
    const stream = await Effect.runPromise(
      Effect.gen(function* () {
        const p = yield* Provider
        return yield* p.stream({
          model: "big-pickle",
          messages: [{ role: "user", content: "count 1 2 3" }],
          stream: true,
        })
      }).pipe(Effect.provide(testLayer))
    )
    const reader = stream.getReader()
    const chunks: string[] = []
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.delta.content) chunks.push(value.delta.content)
    }
    const text = chunks.join("")
    assert.ok(text.length > 0)
  })
})
