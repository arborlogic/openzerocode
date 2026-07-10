import { describe, it } from "node:test"
import assert from "node:assert"
import { toXaiRequestBody } from "./xai-oauth"

describe("xai oauth provider", () => {
  it("moves system messages into required instructions", () => {
    const body = toXaiRequestBody({
      model: "grok-build-0.1",
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
    const body = toXaiRequestBody({
      model: "grok-build-0.1",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    })

    assert.equal(body.instructions, "You are a helpful coding assistant.")
  })

  it("omits unsupported temperature from xAI responses requests", () => {
    const body = toXaiRequestBody({
      model: "grok-build-0.1",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
      temperature: 0,
    })

    assert.equal(Object.hasOwn(body, "temperature"), false)
  })
})
