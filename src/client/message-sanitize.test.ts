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
})
