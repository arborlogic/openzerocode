import { describe, it } from "node:test"
import assert from "node:assert"
import { createStreamState, STREAM_FLUSH_INTERVAL_MS } from "./stream-state"

describe("createStreamState", () => {
  it("notifies once when buffered text is committed", async () => {
    let flushes = 0
    const state = createStreamState(() => { flushes++ })

    state.streamAssistantChunk("hel")
    state.streamAssistantChunk("lo")
    state.streamReasoningChunk("think")

    assert.equal(flushes, 0)
    await new Promise((resolve) => setTimeout(resolve, STREAM_FLUSH_INTERVAL_MS + 20))
    assert.equal(flushes, 1)
    assert.deepEqual(state.parts(), [
      { type: "reasoning", text: "think" },
      { type: "text", text: "hello" },
    ])
  })

  it("accumulates tool call chunks by stream index", () => {
    const state = createStreamState()

    state.streamToolCallChunk(0, { tool: "grep", argumentsChunk: "{\"pattern\"" })
    state.streamToolCallChunk(0, { id: "call_1", argumentsChunk: ":\"TODO\"}" })
    assert.deepEqual(state.parts(), [])
    state.flushPending()

    assert.deepEqual(state.parts(), [
      {
        type: "tool-call",
        id: "call_1",
        tool: "grep",
        input: "{\"pattern\":\"TODO\"}",
      },
    ])
  })

  it("retains tool identity across flushes when later deltas only contain arguments", () => {
    const state = createStreamState()

    state.streamToolCallChunk(0, { id: "call_1", tool: "grep", argumentsChunk: "{\"pattern\"" })
    state.flushPending()
    state.streamToolCallChunk(0, { argumentsChunk: ":\"TODO\"}" })
    state.flushPending()

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

  it("replaces a streamed tool call with its result in the same visual slot", () => {
    const state = createStreamState()

    state.streamToolCallChunk(0, {
      id: "call_1",
      tool: "read",
      argumentsChunk: '{"filePath":"foo.ts"}',
    })
    state.setToolResult({ id: "call_1", tool: "read", output: "running..." })

    assert.deepEqual(state.parts(), [
      {
        type: "tool-result",
        id: "call_1",
        tool: "read",
        output: "running...",
        error: undefined,
      },
    ])
  })

  it("flushes pending text synchronously without losing it", () => {
    const state = createStreamState()

    state.streamAssistantChunk("final")
    state.streamReasoningChunk("thought")
    state.flushPending()

    assert.deepEqual(state.parts(), [
      { type: "reasoning", text: "thought" },
      { type: "text", text: "final" },
    ])
  })
})
