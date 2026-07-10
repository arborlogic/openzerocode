import { describe, it } from "node:test"
import assert from "node:assert/strict"
import type { Message } from "../provider/types"
import { messageToBlocks } from "./message-blocks"

describe("messageToBlocks", () => {
  it("converts structured message parts to display blocks", () => {
    const msg: Message = {
      role: "assistant",
      parts: [
        { type: "reasoning", text: "thinking" },
        { type: "text", text: "answer" },
        { type: "tool-call", id: "call_1", tool: "read", input: '{"filePath":"a.ts"}' },
        { type: "tool-result", id: "call_1", tool: "read", output: "contents" },
        { type: "tool-result", id: "call_2", tool: "bash", output: "boom", error: true },
      ],
    }

    assert.deepEqual(messageToBlocks(msg), [
      { kind: "reasoning", text: "thinking", title: "Thinking" },
      { kind: "assistant", text: "answer" },
      { kind: "tool-call", text: '{"filePath":"a.ts"}', title: "read", meta: { filePath: "a.ts" } },
      { kind: "tool", text: "contents", title: "read" },
      { kind: "error", text: "boom", title: "bash" },
    ])
  })

  it("prefers structured parts over legacy message fields", () => {
    const msg: Message = {
      role: "assistant",
      content: "legacy answer",
      reasoning_content: "legacy reasoning",
      parts: [{ type: "text", text: "part answer" }],
    }

    assert.deepEqual(messageToBlocks(msg), [
      { kind: "assistant", text: "part answer" },
    ])
  })

  it("converts legacy assistant messages with reasoning and content", () => {
    assert.deepEqual(messageToBlocks({ role: "assistant", reasoning_content: "why", content: "done" }), [
      { kind: "reasoning", text: "why", title: "Thinking" },
      { kind: "assistant", text: "done" },
    ])
  })

  it("converts legacy user, tool, and system messages", () => {
    assert.deepEqual(messageToBlocks({ role: "user", content: "hello" }), [
      { kind: "user", text: "hello" },
    ])
    assert.deepEqual(messageToBlocks({ role: "tool", tool_call_id: "call_1", content: "result" }), [
      { kind: "tool", text: "result", title: "call_1" },
    ])
    assert.deepEqual(messageToBlocks({ role: "system", content: "rules" }), [
      { kind: "system", text: "rules" },
    ])
  })

  it("omits empty legacy messages", () => {
    assert.deepEqual(messageToBlocks({ role: "assistant" }), [])
    assert.deepEqual(messageToBlocks({ role: "user" }), [])
    assert.deepEqual(messageToBlocks({ role: "tool" }), [])
    assert.deepEqual(messageToBlocks({ role: "system" }), [])
  })
})
