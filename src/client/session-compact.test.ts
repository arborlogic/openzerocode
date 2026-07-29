import { describe, it } from "node:test"
import assert from "node:assert"
import { estimateTokens } from "../provider/models"
import type { Message } from "../provider/types"
import {
  isCompactSummaryMessage,
  stripCompactSummaryMessages,
  selectCompactionTail,
  buildCompactionTranscript,
  buildPrioritizedCompactionTranscript,
  compactionRetryTokenBudget,
  compactionTranscriptTokenBudget,
  truncateCompactionTranscript,
  cumulativeCompactionSourceCount,
  createCompactSummaryMessage,
  estimateContextTokens,
  shouldAutoCompactContext,
  CONTEXT_WARNING_THRESHOLD,
  COMPACTION_RETRY_TOKEN_CAP,
  COMPACTION_SUMMARY_TOKEN_BUDGET,
  COMPACTION_TRANSCRIPT_TOKEN_CAP,
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

describe("cumulativeCompactionSourceCount", () => {
  it("uses only the newly summarized count for the first compaction", () => {
    assert.equal(cumulativeCompactionSourceCount(12), 12)
  })

  it("includes messages represented by a previous compaction summary", () => {
    assert.equal(cumulativeCompactionSourceCount(8, 12), 20)
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

  it("includes the separately stored current compaction summary", () => {
    const msgs = [user("hello")]
    const summary = "important prior work ".repeat(100)

    assert.ok(
      estimateContextTokens(msgs, "", summary) > estimateContextTokens(msgs),
      "the summary is sent to the provider even though it is absent from message history",
    )
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

  it("considers a separately stored compaction summary for the warning threshold", () => {
    const messages = [user("short")]
    const summary = "prior context ".repeat(100)
    const estimate = estimateContextTokens(messages, "", summary)

    assert.equal(shouldAutoCompactContext(messages, "", estimate + 1, 1, summary), false)
    assert.equal(shouldAutoCompactContext(messages, "", estimate - 1, 1, summary), true)
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

  it("preserves a lightweight marker for multimodal image attachments", () => {
    const msgs: Message[] = [{
      role: "tool",
      tool_call_id: "call_1",
      content: [
        { type: "text", text: "Screenshot captured" },
        { type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(16_000)}` } },
      ],
    }]

    const transcript = buildCompactionTranscript(msgs)
    assert.ok(transcript.includes("Screenshot captured"))
    assert.ok(transcript.includes("[image attachment (image/png, 12 KiB)]"))
    assert.ok(!transcript.includes("A".repeat(100)))
  })

  it("does not duplicate an image marker represented in content and display parts", () => {
    const base64 = "A".repeat(16_000)
    const msgs: Message[] = [{
      role: "user",
      content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } }],
      parts: [{ type: "image", mimeType: "image/png", base64 }],
    }]

    const transcript = buildCompactionTranscript(msgs)
    assert.equal(transcript.match(/\[image attachment \(image\/png, 12 KiB\)\]/g)?.length, 1)
  })

  it("keeps markers for distinct images that have the same type and size", () => {
    const first = "A".repeat(16_000)
    const second = "B".repeat(16_000)
    const msgs: Message[] = [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:image/png;base64,${first}` } },
        { type: "image_url", image_url: { url: `data:image/png;base64,${second}` } },
      ],
      parts: [
        { type: "image", mimeType: "image/png", base64: first },
        { type: "image", mimeType: "image/png", base64: second },
      ],
    }]

    const transcript = buildCompactionTranscript(msgs)
    assert.equal(transcript.match(/\[image attachment \(image\/png, 12 KiB\)\]/g)?.length, 2)
    assert.ok(!transcript.includes("A".repeat(100)))
    assert.ok(!transcript.includes("B".repeat(100)))
  })
})

describe("truncateCompactionTranscript", () => {
  it("caps source history while retaining the newest transcript content", () => {
    const transcript = `old history ${"x".repeat(8_000)}\nnewest state: preserve this`
    const result = truncateCompactionTranscript(transcript, 400)

    assert.ok(estimateContextTokens([user(result)]) <= 430)
    assert.ok(result.startsWith("[Earlier compaction history omitted"))
    assert.ok(result.includes("newest state: preserve this"))
  })

  it("reserves both completion and request overhead within the context window", () => {
    assert.equal(compactionTranscriptTokenBudget(10_000), 7_200)
    assert.equal(compactionTranscriptTokenBudget(1_000), 0)
  })

  it("caps large-window compaction requests to avoid gateway timeouts", () => {
    assert.equal(compactionTranscriptTokenBudget(400_000), COMPACTION_TRANSCRIPT_TOKEN_CAP)
  })

  it("uses a smaller transcript budget when retrying after provider failure", () => {
    assert.equal(compactionRetryTokenBudget(10_000), 4_320)
    assert.equal(compactionRetryTokenBudget(1_000), 0)
    assert.equal(compactionRetryTokenBudget(400_000), COMPACTION_RETRY_TOKEN_CAP)
  })
})

describe("buildPrioritizedCompactionTranscript", () => {
  it("retains the complete previous summary when repeated compaction truncates new history", () => {
    const previousSummary = "Critical prior state: migration is half complete; do not discard this."
    const result = buildPrioritizedCompactionTranscript(
      previousSummary,
      [user(`old new history ${"x".repeat(8_000)}`), user("latest new state: run tests")],
      400,
    )

    assert.ok(result.includes(`[PREVIOUS COMPACTION SUMMARY]\n${previousSummary}`))
    assert.ok(result.includes("latest new state: run tests"))
    assert.ok(result.includes("[Earlier compaction history omitted"))
  })

  it("retains a previous summary even when no budget remains for new history", () => {
    const previousSummary = "Keep this older context."
    const result = buildPrioritizedCompactionTranscript(previousSummary, [user("new history")], 14)

    assert.equal(result, `[PREVIOUS COMPACTION SUMMARY]\n${previousSummary}`)
  })

  it("truncates against the fully serialized request budget", () => {
    const messages = [user(`old escaped history ${"\\\"".repeat(4_000)} latest state`)]
    const requestFits = (transcript: string) => estimateContextTokens([
      { role: "system", content: "Compaction prompt" },
      { role: "user", content: `Summarize:\n\n${transcript}` },
    ]) <= 300

    const result = buildPrioritizedCompactionTranscript(undefined, messages, 300, requestFits)

    assert.ok(requestFits(result))
    assert.ok(result.includes("latest state"))
    assert.ok(result.startsWith("[Earlier compaction history omitted"))
  })

  it("bounds an oversized legacy summary so repeated compaction can continue", () => {
    const previousSummary = `legacy state ${"x".repeat(8_000)} newest prior fact`
    const requestFits = (transcript: string) => estimateContextTokens([user(transcript)]) <= 300

    const result = buildPrioritizedCompactionTranscript(previousSummary, [user("new history")], 300, requestFits)

    assert.ok(requestFits(result))
    assert.ok(result.includes("newest prior fact"))
    assert.ok(result.startsWith("[Earlier compaction history omitted"))
  })

  it("applies the transcript cap even when the full request has ample room", () => {
    const previousSummary = `legacy state ${"x".repeat(40_000)} newest prior fact`
    const tokenBudget = 300

    const result = buildPrioritizedCompactionTranscript(
      previousSummary,
      [user("new history")],
      tokenBudget,
      () => true,
    )

    assert.ok(estimateTokens(result) <= tokenBudget)
    assert.ok(result.includes("newest prior fact"))
    assert.ok(result.startsWith("[Earlier compaction history omitted"))
  })

  it("keeps the retry cap while also shrinking for serialized request overhead", () => {
    const previousSummary = `legacy escaped state ${"\\\"".repeat(12_000)} newest prior fact`
    const requestFits = (transcript: string) => estimateContextTokens([
      { role: "system", content: "Compaction prompt" },
      { role: "user", content: `Summarize:\n\n${transcript}` },
    ]) <= 600

    const result = buildPrioritizedCompactionTranscript(
      previousSummary,
      [user("new history")],
      300,
      requestFits,
    )

    assert.ok(estimateTokens(result) <= 300)
    assert.ok(requestFits(result))
    assert.ok(result.includes("newest prior fact"))
    assert.ok(result.startsWith("[Earlier compaction history omitted"))
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
    const result = selectCompactionTail(msgs, 1000) // tiny context → no tail budget after summary reserve
    // Compact summaries are stripped
    assert.ok(!result.head.some((m) => isCompactSummaryMessage(m)))
    assert.ok(!result.tail.some((m) => isCompactSummaryMessage(m)))
    // The head is summarized; for a tiny context limit it is valid for the
    // tail to be empty rather than retaining an oversized recent message.
    assert.ok(result.head.length > 0, "expected head to have messages")
    // All non-summary messages are accounted for
    assert.equal(result.head.length + result.tail.length, msgs.length - 1)
  })

  it("keeps the retained tail within its token budget", () => {
    // Create 10 user/assistant pairs.
    const msgs: Message[] = []
    for (let i = 0; i < 10; i++) {
      msgs.push(user(`q${i}`), assistant(`a${i}`))
    }
    const contextLimit = 10_000
    const result = selectCompactionTail(msgs, contextLimit)
    const tailBudget = Math.floor(contextLimit * 0.2) - COMPACTION_SUMMARY_TOKEN_BUDGET

    assert.ok(estimateContextTokens(result.tail) <= tailBudget)
    assert.equal(result.head.length + result.tail.length, msgs.length)
  })

  it("summarizes oversized recent tool output instead of retaining an over-limit tail", () => {
    const contextLimit = 10_000
    const msgs: Message[] = [
      user("inspect the build log"),
      assistantWithTools([{ id: "c1", name: "bash", args: "{}" }]),
      toolMsg("c1", "log line\n".repeat(20_000)),
      assistant("the build failed"),
      user("find the cause"),
      assistant("I will inspect it"),
      user("continue"),
    ]

    const result = selectCompactionTail(msgs, contextLimit)

    assert.ok(result.head.length > 0)
    assert.ok(estimateContextTokens(result.tail) < contextLimit * CONTEXT_WARNING_THRESHOLD)
    assert.ok(!result.tail.some((message) => message.role === "tool" && typeof message.content === "string" && message.content.length > 10_000))
  })

  it("does not let an image payload alone trigger compaction", () => {
    const contextLimit = 10_000
    const imageDataUrl = `data:image/png;base64,${"A".repeat(80_000)}`
    const msgs: Message[] = [
      assistantWithTools([{ id: "c1", name: "analyze_image", args: "{}" }]),
      {
        role: "tool",
        tool_call_id: "c1",
        content: [
          { type: "text", text: "Image analysis completed" },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
      assistant("The screenshot looks correct."),
      user("Please continue."),
    ]

    const result = selectCompactionTail(msgs, contextLimit)

    assert.equal(result.head.length, 0, "only textual context should determine compaction")
    assert.equal(result.tail.length, msgs.length)
  })

  it("limits retained images with a request-token allowance after compaction begins", () => {
    const image = (id: number): Message => ({
      role: "user",
      content: [
        { type: "text", text: `image ${id}` },
        { type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(100_000)}` } },
      ],
    })
    const msgs = [user("older text ".repeat(1_000)), ...Array.from({ length: 7 }, (_, i) => image(i))]

    const result = selectCompactionTail(msgs, 20_000)

    assert.ok(result.head.length > 0)
    assert.equal(result.tail.length, 1, "the request tail should retain only one 2,048-token image allowance")
    assert.equal(result.tail[0]?.role, "user")
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
