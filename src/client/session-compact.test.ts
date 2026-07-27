import { describe, it } from "node:test"
import assert from "node:assert"
import type { Message } from "../provider/types"
import {
  isCompactSummaryMessage,
  stripCompactSummaryMessages,
  selectCompactionTail,
  buildCompactionTranscript,
  createCompactSummaryMessage,
  estimateContextTokens,
  shouldAutoCompactContext,
  CONTEXT_WARNING_THRESHOLD,
  COMPACT_SUMMARY_PREFIX,
} from "./session-compact"

function user(text: string): Message {
  return { role: "user", content: text }
}
function assistant(text: string): Message {
  return { role: "assistant", content: text }
}
function toolMsg(toolCallId: string, output: string): Message {
  return { role: "tool", tool_call_id: toolCallId, content: output }
}
function assistantWithTools(toolCalls: { id: string; name: string; args: string }[]): Message {
  return {
    role: "assistant",
    content: "",
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.args },
    })),
  }
}
function compactSummary(text: string): Message {
  return { role: "system", content: `${COMPACT_SUMMARY_PREFIX}\n${text}` }
}

describe("isCompactSummaryMessage", () => {
  it("detects compact summary messages", () => {
    assert.ok(isCompactSummaryMessage(compactSummary("summary here")))
  })

  it("returns false for regular system messages", () => {
    assert.ok(!isCompactSummaryMessage({ role: "system", content: "something else" }))
  })

  it("returns false for non-system messages", () => {
    assert.ok(!isCompactSummaryMessage(user("hi")))
  })
})

describe("stripCompactSummaryMessages", () => {
  it("removes compact summary messages", () => {
    const msgs = [user("hi"), compactSummary("old summary"), assistant("hello")]
    const result = stripCompactSummaryMessages(msgs)
    assert.equal(result.length, 2)
    assert.equal(result[0]?.content, "hi")
    assert.equal(result[1]?.content, "hello")
  })

  it("returns all messages if none are compact summaries", () => {
    const msgs = [user("hi"), assistant("hello")]
    assert.equal(stripCompactSummaryMessages(msgs).length, 2)
  })
})

describe("createCompactSummaryMessage", () => {
  it("creates a system message with prefix", () => {
    const msg = createCompactSummaryMessage("executed 3 commands")
    assert.equal(msg.role, "system")
    const text = typeof msg.content === "string" ? msg.content : ""
    assert.ok(text.startsWith(COMPACT_SUMMARY_PREFIX))
    assert.ok(text.includes("executed 3 commands"))
  })
})

describe("estimateContextTokens", () => {
  it("counts serialized message fields, not just content", () => {
    const withToolPayload: Message[] = [
      assistantWithTools([{ id: "c1", name: "read", args: "x".repeat(400) }]),
      toolMsg("c1", "y".repeat(400)),
    ]
    const contentOnly: Message[] = withToolPayload.map((msg) => ({ role: msg.role, content: msg.content }))

    assert.ok(
      estimateContextTokens(withToolPayload) > estimateContextTokens(contentOnly),
      "expected tool calls and tool outputs to increase the context estimate",
    )
  })

  it("strips compact summaries and includes pending input", () => {
    const msgs = [user("hello"), compactSummary("old summary ".repeat(200))]

    assert.equal(estimateContextTokens(msgs), estimateContextTokens([user("hello")]))
    assert.ok(estimateContextTokens(msgs, "next prompt".repeat(100)) > estimateContextTokens(msgs))
  })

  it("ignores parts that duplicate assistant and tool provider fields", () => {
    const output = "large output ".repeat(200)
    const messages: Message[] = [
      {
        ...assistantWithTools([{ id: "c1", name: "read", args: '{"filePath":"a.ts"}' }]),
        parts: [{ type: "tool-call", id: "c1", tool: "read", input: '{"filePath":"a.ts"}' }],
      },
      {
        ...toolMsg("c1", output),
        parts: [{ type: "tool-result", id: "c1", tool: "read", output }],
      },
    ]
    const withoutParts = messages.map(({ parts: _parts, ...message }) => message)

    assert.equal(estimateContextTokens(messages), estimateContextTokens(withoutParts))
  })
})

describe("shouldAutoCompactContext", () => {
  it("uses a 60% default threshold", () => {
    assert.equal(CONTEXT_WARNING_THRESHOLD, 0.6)
  })

  it("returns true only after estimated context crosses the warning threshold", () => {
    const messages = [user("hello ".repeat(200))]
    const estimate = estimateContextTokens(messages)
    const limitAboveThreshold = Math.ceil(estimate / CONTEXT_WARNING_THRESHOLD) + 100
    const limitBelowThreshold = Math.max(1, Math.floor(estimate / CONTEXT_WARNING_THRESHOLD) - 100)

    assert.equal(shouldAutoCompactContext(messages, "", limitAboveThreshold), false)
    assert.equal(shouldAutoCompactContext(messages, "", limitBelowThreshold), true)
  })

  it("accepts a user-configured threshold", () => {
    const messages = [user("hello ".repeat(200))]
    const estimate = estimateContextTokens(messages)
    const contextLimit = Math.ceil(estimate / 0.7)

    assert.equal(shouldAutoCompactContext(messages, "", contextLimit, 0.6), true)
    assert.equal(shouldAutoCompactContext(messages, "", contextLimit, 0.8), false)
  })
})

describe("buildCompactionTranscript", () => {
  it("builds readable transcript from messages", () => {
    const msgs = [user("hello"), assistant("world")]
    const transcript = buildCompactionTranscript(msgs)
    assert.ok(transcript.includes("USER:"))
    assert.ok(transcript.includes("ASSISTANT:"))
    assert.ok(transcript.includes("hello"))
    assert.ok(transcript.includes("world"))
  })

  it("separates messages with dashes", () => {
    const msgs = [user("a"), assistant("b")]
    const transcript = buildCompactionTranscript(msgs)
    assert.ok(transcript.includes("---"))
  })

  it("includes tool calls and tool results from message parts", () => {
    const msgs: Message[] = [{
      role: "assistant",
      parts: [
        { type: "tool-call", id: "call_1", tool: "read", input: '{"filePath":"README.md"}' },
        { type: "tool-result", id: "call_1", tool: "read", output: "# README" },
      ],
    }]
    const transcript = buildCompactionTranscript(msgs)
    assert.ok(transcript.includes("[tool-call:read]"))
    assert.ok(transcript.includes('{"filePath":"README.md"}'))
    assert.ok(transcript.includes("[tool-result:read]"))
    assert.ok(transcript.includes("# README"))
  })
})

describe("selectCompactionTail", () => {
  it("returns all messages when count <= 6", () => {
    const msgs = [user("a"), assistant("b"), user("c"), assistant("d")]
    const result = selectCompactionTail(msgs, 128_000)
    assert.deepEqual(result, { head: [], tail: msgs })
  })

  it("strips compact summary messages before splitting", () => {
    // Use a small context limit so that some messages land in head
    const msgs: Message[] = [compactSummary("old summary")]
    for (let i = 0; i < 80; i++) {
      msgs.push(user("Tell me about programming language design. ".repeat(15)))
      msgs.push(assistant("Languages have evolved significantly. ".repeat(15)))
    }
    const result = selectCompactionTail(msgs, 1000) // tiny budget → tailBudget = 1200
    // Compact summaries are stripped
    assert.ok(!result.head.some((m) => isCompactSummaryMessage(m)))
    assert.ok(!result.tail.some((m) => isCompactSummaryMessage(m)))
    // At least some messages land in head and tail
    assert.ok(result.head.length > 0, "expected head to have messages")
    assert.ok(result.tail.length > 0, "expected tail to have messages")
    // All non-summary messages are accounted for
    assert.equal(result.head.length + result.tail.length, msgs.length - 1)
  })

  it("keeps at least 6 messages in tail even with tiny budget", () => {
    // Create 10 user/assistant pairs
    const msgs: Message[] = []
    for (let i = 0; i < 10; i++) {
      msgs.push(user(`q${i}`), assistant(`a${i}`))
    }
    const result = selectCompactionTail(msgs, 1000) // tiny budget
    // Should keep minTailMessages (6) in tail: at least 6 messages
    assert.ok(result.tail.length >= 6)
    assert.ok(result.head.length + result.tail.length <= msgs.length)
  })

  it("does not split in the middle of a tool call cycle", () => {
    const msgs: Message[] = [
      user("list files"),
      assistantWithTools([{ id: "c1", name: "bash", args: "{}" }]),
      toolMsg("c1", "file1.txt\nfile2.txt"),
      assistant("done"),
      user("read file1"),
      assistantWithTools([{ id: "c2", name: "read", args: '{"filePath":"file1.txt"}' }]),
      toolMsg("c2", "content here"),
      assistant("here it is"),
    ]
    const result = selectCompactionTail(msgs, 128_000)
    // The tail should not start with a tool message
    if (result.tail.length > 0) {
      assert.notEqual(result.tail[0]?.role, "tool")
    }
  })
})
