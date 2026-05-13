import { describe, it } from "node:test"
import assert from "node:assert"
import type { Message } from "../provider/types"
import { sanitizeMessages } from "./message-sanitize"

describe("sanitizeMessages", () => {
  it("drops assistant tool calls when results are incomplete", () => {
    const input: Message[] = [
      {
        role: "assistant",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "read", arguments: "{}" } },
          { id: "call_2", type: "function", function: { name: "grep", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "done" },
      { role: "user", content: "next question" },
    ]

    assert.deepEqual(sanitizeMessages(input), [
      { role: "user", content: "next question" },
    ])
  })

  it("keeps complete assistant tool chains", () => {
    const input: Message[] = [
      {
        role: "assistant",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "read", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "done" },
      { role: "assistant", content: "final answer" },
    ]

    assert.deepEqual(sanitizeMessages(input), input)
  })

  it("drops orphaned tool messages without preceding assistant", () => {
    const input: Message[] = [
      // Orphaned: assistant for call_xxx was compacted into head
      { role: "tool", tool_call_id: "call_orphan", content: "result" },
      { role: "user", content: "next question" },
      { role: "assistant", content: "valid response" },
    ]

    assert.deepEqual(sanitizeMessages(input), [
      { role: "user", content: "next question" },
      { role: "assistant", content: "valid response" },
    ])
  })

  it("drops orphaned tool messages with no matching tool_call_id", () => {
    const input: Message[] = [
      { role: "tool", content: "result without id" },
      { role: "user", content: "hi" },
    ]

    assert.deepEqual(sanitizeMessages(input), [
      { role: "user", content: "hi" },
    ])
  })

  it("keeps tool messages that follow a valid assistant chain even when non-tool messages precede", () => {
    const input: Message[] = [
      { role: "user", content: "do it" },
      {
        role: "assistant",
        tool_calls: [
          { id: "call_1", type: "function", function: { name: "read", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "done" },
      { role: "assistant", content: "final" },
    ]

    assert.deepEqual(sanitizeMessages(input), input)
  })

  it("drops orphaned tool messages but keeps valid ones from preceding assistants", () => {
    const input: Message[] = [
      // Orphaned (compaction split artifact)
      { role: "tool", tool_call_id: "call_orphan", content: "old result" },
      // Valid pair
      { role: "user", content: "do something" },
      {
        role: "assistant",
        tool_calls: [
          { id: "call_new", type: "function", function: { name: "read", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_new", content: "new result" },
    ]

    assert.deepEqual(sanitizeMessages(input), [
      { role: "user", content: "do something" },
      {
        role: "assistant",
        tool_calls: [
          { id: "call_new", type: "function", function: { name: "read", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "call_new", content: "new result" },
    ])
  })
})
