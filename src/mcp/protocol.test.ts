import { describe, it } from "node:test"
import assert from "node:assert"
import { encodeMessage, decodeMessages, contentToText } from "./protocol"

describe("mcp protocol", () => {
  it("encodes a request as one newline-terminated line", () => {
    const line = encodeMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    assert.ok(line.endsWith("\n"))
    assert.equal(line.indexOf("\n"), line.length - 1)
    assert.deepEqual(JSON.parse(line.trim()), { jsonrpc: "2.0", id: 1, method: "tools/list" })
  })

  it("decodes complete messages and keeps the partial remainder", () => {
    const a = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } })
    const b = JSON.stringify({ jsonrpc: "2.0", id: 2, result: { ok: false } })
    const { messages, rest } = decodeMessages(`${a}\n${b}\n{"jsonrpc":"2.0","id`)
    assert.equal(messages.length, 2)
    assert.equal((messages[0]!.result as { ok: boolean }).ok, true)
    assert.equal(rest, '{"jsonrpc":"2.0","id')
  })

  it("skips non-JSON noise on stdout", () => {
    const good = JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} })
    const { messages } = decodeMessages(`listening on stdio...\n${good}\n`)
    assert.equal(messages.length, 1)
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
