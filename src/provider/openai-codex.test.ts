import { describe, it } from "node:test"
import assert from "node:assert"
import { toCodexRequestBody } from "./openai-codex"

describe("openai codex provider", () => {
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
