import { describe, it } from "node:test"
import assert from "node:assert"
import { createAssistantMessage, createToolMessage } from "./message-parts"
import type { ToolCall } from "./types"

describe("createAssistantMessage", () => {
  it("creates a message with content only", () => {
    const msg = createAssistantMessage({ content: "Hello" })
    assert.equal(msg.role, "assistant")
    assert.equal(msg.content, "Hello")
    assert.equal(msg.reasoning_content, undefined)
    assert.equal(msg.tool_calls, undefined)
    assert.deepEqual(msg.parts, [{ type: "text", text: "Hello" }])
  })

  it("creates a message with reasoning content", () => {
    const msg = createAssistantMessage({ content: "Answer", reasoning_content: "Let me think..." })
    assert.equal(msg.content, "Answer")
    assert.equal(msg.reasoning_content, "Let me think...")
    assert.deepEqual(msg.parts, [
      { type: "reasoning", text: "Let me think..." },
      { type: "text", text: "Answer" },
    ])
  })

  it("creates a message with tool calls", () => {
    const toolCalls: ToolCall[] = [
      { id: "call_1", type: "function", function: { name: "read", arguments: '{"filePath":"test.txt"}' } },
    ]
    const msg = createAssistantMessage({ content: "", tool_calls: toolCalls })
    assert.equal(msg.content, "")
    assert.deepEqual(msg.tool_calls, toolCalls)
    assert.deepEqual(msg.parts, [
      { type: "tool-call", id: "call_1", tool: "read", input: '{"filePath":"test.txt"}' },
    ])
  })

  it("creates a message with content, reasoning, and tool calls", () => {
    const toolCalls: ToolCall[] = [
      { id: "call_1", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } },
    ]
    const msg = createAssistantMessage({
      content: "Running...",
      reasoning_content: "Need to list files",
      tool_calls: toolCalls,
    })
    assert.deepEqual(msg.parts, [
      { type: "reasoning", text: "Need to list files" },
      { type: "text", text: "Running..." },
      { type: "tool-call", id: "call_1", tool: "bash", input: '{"command":"ls"}' },
    ])
  })

  it("handles empty input gracefully", () => {
    const msg = createAssistantMessage({})
    assert.equal(msg.role, "assistant")
    assert.equal(msg.content, undefined)
    assert.equal(msg.reasoning_content, undefined)
    assert.equal(msg.tool_calls, undefined)
    assert.equal(msg.parts, undefined)
  })

  it("handles empty tool_calls array (parts is undefined when all sub-arrays are empty)", () => {
    const msg = createAssistantMessage({ tool_calls: [] })
    assert.equal(msg.content, undefined)
    // parts is undefined because [].length === 0
    assert.equal(msg.parts, undefined)
  })
})

describe("createToolMessage", () => {
  it("creates a tool result message", () => {
    const msg = createToolMessage({ tool_call_id: "call_1", tool: "read", output: "file content" })
    assert.equal(msg.role, "tool")
    assert.equal(msg.tool_call_id, "call_1")
    assert.equal(msg.content, "file content")
    assert.deepEqual(msg.parts, [
      { type: "tool-result", id: "call_1", tool: "read", output: "file content", error: undefined },
    ])
  })

  it("creates a tool error message", () => {
    const msg = createToolMessage({ tool_call_id: "call_2", tool: "bash", output: "command not found", error: true })
    assert.equal(msg.role, "tool")
    assert.equal(msg.content, "command not found")
    assert.deepEqual(msg.parts, [
      { type: "tool-result", id: "call_2", tool: "bash", output: "command not found", error: true },
    ])
  })

  it("handles missing tool_call_id", () => {
    const msg = createToolMessage({ output: "result without id" })
    assert.equal(msg.tool_call_id, undefined)
    assert.equal(msg.content, "result without id")
    assert.deepEqual(msg.parts, [
      { type: "tool-result", id: undefined, tool: undefined, output: "result without id", error: undefined },
    ])
  })
})
