import { describe, it } from "node:test"
import assert from "node:assert"
import { Effect } from "effect"
import { layer, toCodexRequestBody } from "./openai-codex"
import { Provider } from "./types"

describe("openai codex provider", () => {
  it("includes all supported Codex models", async () => {
    const models = await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* Provider
        return yield* provider.models()
      }).pipe(Effect.provide(layer({}))),
    )

    const modelIds = models.map(({ id }) => id)
    for (const id of ["gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]) {
      assert.ok(modelIds.includes(id), `expected Codex model list to include ${id}`)
    }
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

  it("uses fallback instructions when no system message exists", () => {
    const body = toCodexRequestBody({
      model: "gpt-5.4",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    })

    assert.equal(body.instructions, "You are a helpful coding assistant.")
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
})
