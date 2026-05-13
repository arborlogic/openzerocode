import { describe, it } from "node:test"
import assert from "node:assert"
import { createStreamState } from "./stream-state"

describe("createStreamState", () => {
  it("accumulates tool call chunks by stream index", () => {
    const state = createStreamState()

    state.streamToolCallChunk(0, { tool: "grep", argumentsChunk: "{\"pattern\"" })
    state.streamToolCallChunk(0, { id: "call_1", argumentsChunk: ":\"TODO\"}" })

    assert.deepEqual(state.parts(), [
      {
        type: "tool-call",
        id: "call_1",
        tool: "grep",
        input: "{\"pattern\":\"TODO\"}",
      },
    ])
  })

  it("updates tool results in place", () => {
    const state = createStreamState()

    state.setToolResult({ id: "call_1", tool: "read", output: "running..." })
    state.setToolResult({ id: "call_1", tool: "read", output: "Read foo\n---\nbar" })

    assert.deepEqual(state.parts(), [
      {
        type: "tool-result",
        id: "call_1",
        tool: "read",
        output: "Read foo\n---\nbar",
        error: undefined,
      },
    ])
  })
})
