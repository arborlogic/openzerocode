import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { Effect, Schema } from "effect"
import { parseToolArguments } from "./arguments"
import { Def, Result } from "./types"

const bash = new Def({
  id: "bash",
  description: "test bash",
  parameters: Schema.Struct({ command: Schema.String }),
  execute: () => Effect.succeed(new Result({ title: "Bash", output: "ok" })),
})

describe("parseToolArguments", () => {
  it("reports a missing required argument without leaking Effect internals", () => {
    const parsed = parseToolArguments(bash, "{}")
    assert.equal(parsed.ok, false)
    if (parsed.ok) return
    assert.equal(parsed.result.title, "Error")
    assert.match(parsed.result.output, /missing required parameter "command"/)
    assert.match(parsed.result.output, /Received: \{\}/)
    assert.doesNotMatch(parsed.result.output, /Cause\(|Die\(/)
  })

  it("distinguishes truncated JSON from schema validation failures", () => {
    const parsed = parseToolArguments(bash, '{"command":')
    assert.equal(parsed.ok, false)
    if (parsed.ok) return
    assert.match(parsed.result.output, /arguments are not valid JSON/)
    assert.match(parsed.result.output, /complete JSON object/)
  })

  it("preserves MCP arguments when the local schema is empty", () => {
    const mcp = new Def({
      id: "server__search",
      description: "MCP search",
      parameters: Schema.Struct({}),
      jsonSchema: { type: "object", properties: { query: { type: "string" } } },
      execute: bash.execute,
    })
    assert.deepEqual(parseToolArguments(mcp, '{"query":"hello","options":{"limit":5}}'), {
      ok: true,
      value: { query: "hello", options: { limit: 5 } },
    })
  })

  it("rejects non-object arguments and incorrect parameter types", () => {
    for (const raw of ["null", "[]", '"hello"', '{"command":123}']) {
      assert.equal(parseToolArguments(bash, raw).ok, false, raw)
    }
  })

  it("validates missing provider arguments as an empty object", () => {
    const parsed = parseToolArguments(bash, undefined)
    assert.equal(parsed.ok, false)
    if (parsed.ok) return
    assert.match(parsed.result.output, /missing required parameter "command"/)
  })

  it("returns validated arguments", () => {
    assert.deepEqual(parseToolArguments(bash, '{"command":"echo hello"}'), {
      ok: true,
      value: { command: "echo hello" },
    })
  })
})
