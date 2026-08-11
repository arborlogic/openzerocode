import { describe, it } from "node:test"
import assert from "node:assert"
import { createResponsesStream, messagesToInput, toResponsesRequestBody } from "./responses-api"

describe("responses-api multimodal tool results", () => {
  it("forwards tool image attachments as a follow-up user input_image message", () => {
    const input = messagesToInput([
      {
        role: "assistant",
        content: undefined,
        tool_calls: [{
          id: "call_img",
          type: "function",
          function: { name: "analyze_image", arguments: "{\"path\":\"shot.png\"}" },
        }],
      },
      {
        role: "tool",
        tool_call_id: "call_img",
        content: [
          { type: "text", text: "Screenshot captured" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAECAw==" } },
        ],
      },
    ])

    assert.deepEqual(input[0], {
      type: "function_call",
      call_id: "call_img",
      name: "analyze_image",
      arguments: "{\"path\":\"shot.png\"}",
    })
    assert.deepEqual(input[1], {
      type: "function_call_output",
      call_id: "call_img",
      output: "Screenshot captured",
    })
    assert.equal(input[2].role, "user")
    assert.deepEqual(input[2].content, [
      {
        type: "input_text",
        text: "The previous tool result included these image attachment(s). Analyze them directly as part of the conversation.",
      },
      {
        type: "input_image",
        image_url: "data:image/png;base64,AAECAw==",
      },
    ])
  })

  it("preserves plain tool text output without inventing image messages", () => {
    const input = messagesToInput([
      {
        role: "tool",
        tool_call_id: "call_1",
        content: "file contents",
      },
    ])

    assert.deepEqual(input, [{
      type: "function_call_output",
      call_id: "call_1",
      output: "file contents",
    }])
  })

  it("converts user multimodal content to Responses input_image parts", () => {
    const body = toResponsesRequestBody({
      model: "grok-4.5",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "what is in this image?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,AAECAw==" } },
        ],
      }],
      stream: false,
    })

    assert.deepEqual(body.input, [{
      role: "user",
      content: [
        { type: "input_text", text: "what is in this image?" },
        { type: "input_image", image_url: "data:image/png;base64,AAECAw==" },
      ],
    }])
  })
})

describe("responses-api streaming", () => {
  it("closes on response.completed without waiting for transport EOF", async () => {
    const encoder = new TextEncoder()
    let transportCancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          "event: response.completed",
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":2}}}',
          "",
          "",
        ].join("\n")))
        // Deliberately leave the transport open to emulate a keep-alive proxy.
      },
      cancel() {
        transportCancelled = true
      },
    })

    const reader = createResponsesStream(body).getReader()
    const first = await reader.read()
    const second = await reader.read()

    assert.equal(first.value?.finish_reason, "stop")
    assert.equal(second.done, true)
    assert.equal(transportCancelled, true)
  })

  it("recognizes a CRLF-delimited terminal event on a keep-alive transport", async () => {
    const encoder = new TextEncoder()
    let transportCancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode([
          "event: response.completed",
          'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":2}}}',
          "",
          "",
        ].join("\r\n")))
      },
      cancel() {
        transportCancelled = true
      },
    })

    const reader = createResponsesStream(body).getReader()
    const first = await reader.read()
    const second = await reader.read()

    assert.equal(first.value?.finish_reason, "stop")
    assert.equal(second.done, true)
    assert.equal(transportCancelled, true)
  })
})
