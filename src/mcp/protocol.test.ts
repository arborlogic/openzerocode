import { describe, it } from "node:test"
import assert from "node:assert"
import { encodeMessage, decodeMessages, contentToText } from "./protocol"

describe("mcp protocol", () => {
  it("encodes a request with Content-Length framing", () => {
    const framed = encodeMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    const [header, body] = framed.split("\r\n\r\n")
    assert.match(header!, /^Content-Length: \d+$/)
    assert.equal(Number(header!.slice("Content-Length: ".length)), Buffer.byteLength(body!, "utf8"))
    assert.deepEqual(JSON.parse(body!), { jsonrpc: "2.0", id: 1, method: "tools/list" })
  })

  it("decodes complete messages and keeps the partial remainder", () => {
    const a = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } })
    const b = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { ok: false } })
    const { messages, rest } = decodeMessages(`${a}\n${b}\n{"jsonrpc":"2.0","id`)
    assert.equal(messages.length, 2)
    assert.equal((messages[0]!.result as { ok: boolean }).ok, true)
    assert.equal(rest.toString("utf8"), '{"jsonrpc":"2.0","id')
  })

  it("decodes Content-Length framed messages", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } })
    const framed = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`
    const { messages, rest } = decodeMessages(framed)
    assert.equal(messages.length, 1)
    assert.equal((messages[0]!.result as { ok: boolean }).ok, true)
    assert.equal(rest.length, 0)
  })

  it("decodes LF-only Content-Length framed messages", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } })
    const framed = `Content-Length: ${Buffer.byteLength(body, "utf8")}\n\n${body}`
    const { messages, rest } = decodeMessages(framed)
    assert.equal(messages.length, 1)
    assert.equal((messages[0]!.result as { ok: boolean }).ok, true)
    assert.equal(rest.length, 0)
  })

  it("uses byte offsets for UTF-8 bodies split across chunks", () => {
    const firstBody = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { text: "こんにちは" } })
    const secondBody = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { ok: true } })
    const firstFrame = Buffer.from(`Content-Length: ${Buffer.byteLength(firstBody, "utf8")}\r\n\r\n${firstBody}`, "utf8")
    const secondFrame = Buffer.from(`Content-Length: ${Buffer.byteLength(secondBody, "utf8")}\r\n\r\n${secondBody}`, "utf8")
    const combined = Buffer.concat([firstFrame, secondFrame])

    const split = firstFrame.length - 2
    const partial = decodeMessages(combined.subarray(0, split))
    assert.equal(partial.messages.length, 0)
    assert.deepEqual(partial.rest, combined.subarray(0, split))

    const complete = decodeMessages(Buffer.concat([partial.rest, combined.subarray(split)]))
    assert.equal(complete.messages.length, 2)
    assert.equal((complete.messages[0]!.result as { text: string }).text, "こんにちは")
    assert.equal((complete.messages[1]!.result as { ok: boolean }).ok, true)
    assert.equal(complete.rest.length, 0)
  })

  it("keeps incomplete Content-Length framed messages", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } })
    const framed = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`
    const { messages, rest } = decodeMessages(framed.slice(0, -5))
    assert.equal(messages.length, 0)
    assert.equal(rest.toString("utf8"), framed.slice(0, -5))
  })

  it("skips non-JSON noise on stdout", () => {
    const good = JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })
    const { messages } = decodeMessages(`listening on stdio...\n${good}\n`)
    assert.equal(messages.length, 1)
  })

  it("drops noise before a framed message without corrupting body offsets", () => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { text: "é" } })
    const framed = `noise with unicode こんにちは\nContent-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`
    const { messages, rest } = decodeMessages(Buffer.from(framed, "utf8"))
    assert.equal(messages.length, 1)
    assert.equal((messages[0]!.result as { text: string }).text, "é")
    assert.equal(rest.length, 0)
  })

  it("caps unparseable buffered stdout noise", () => {
    const { messages, rest } = decodeMessages("x".repeat(5 * 1024 * 1024))
    assert.equal(messages.length, 0)
    assert.equal(rest.length, 4 * 1024 * 1024)
  })

  it("flattens text content and marks images", () => {
    assert.equal(
      contentToText({ content: [{ type: "text", text: "hello" }, { type: "text", text: "world" }] }),
      "hello\nworld",
    )
    assert.equal(contentToText({ content: [{ type: "image", data: "x", mimeType: "image/png" }] }), "[image omitted]")
    assert.equal(contentToText({ content: [] }), "(no output)")
  })
})
