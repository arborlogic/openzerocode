import { describe, it } from "node:test"
import assert from "node:assert"
import { Schema, Effect } from "effect"
import { Def, Result } from "../tool/tool"
import { convertToolToDef, convertToolsToDefs, convertToolResult } from "./convert"

describe("convertToolToDef", () => {
  it("converts a schema to a ToolDef", () => {
    const def = new Def({
      id: "test_tool",
      description: "A test tool",
      parameters: Schema.Struct({
        name: Schema.String,
        count: Schema.Number,
      }),
      execute: () => Effect.succeed(new Result({ title: "Done", output: "ok" })),
    })

    const result = convertToolToDef(def)
    assert.equal(result.type, "function")
    assert.equal(result.function.name, "test_tool")
    assert.equal(result.function.description, "A test tool")
    assert.ok(result.function.parameters)
    const props = (result.function.parameters as Record<string, unknown>).properties as Record<string, unknown>
    assert.ok(props)
    assert.ok(props.name)
    assert.ok(props.count)
  })

  it("converts a no-parameter tool (empty struct normalised to type: object)", () => {
    const def = new Def({
      id: "noop",
      description: "No-op tool",
      parameters: Schema.Struct({}),
      execute: () => Effect.succeed(new Result({ title: "Done", output: "ok" })),
    })

    const result = convertToolToDef(def)
    assert.equal(result.function.name, "noop")
    const params = result.function.parameters as Record<string, unknown>
    assert.equal(params.type, "object")
    assert.ok(params.properties)
  })
})

describe("convertToolsToDefs", () => {
  it("converts multiple tools", () => {
    const defs = [
      new Def({
        id: "tool_a",
        description: "Tool A",
        parameters: Schema.Struct({}),
        execute: () => Effect.succeed(new Result({ title: "A", output: "a" })),
      }),
      new Def({
        id: "tool_b",
        description: "Tool B",
        parameters: Schema.Struct({}),
        execute: () => Effect.succeed(new Result({ title: "B", output: "b" })),
      }),
    ]

    const result = convertToolsToDefs(defs)
    assert.equal(result.length, 2)
    assert.equal(result[0]!.function.name, "tool_a")
    assert.equal(result[1]!.function.name, "tool_b")
  })

  it("returns empty array for empty input", () => {
    assert.deepEqual(convertToolsToDefs([]), [])
  })
})

describe("convertToolResult", () => {
  it("formats a result with title and output", () => {
    const result = new Result({ title: "Read", output: "file content here" })
    const formatted = convertToolResult(result)
    assert.equal(formatted, "Read\n---\nfile content here")
  })

  it("includes truncated output if original is long", () => {
    const longOutput = "A".repeat(50_000)
    const result = new Result({ title: "Bash", output: longOutput })
    const formatted = convertToolResult(result)
    assert.ok(formatted.startsWith("Bash\n---\n"))
    assert.ok(formatted.includes("[truncated:"))
  })

  it("handles empty output", () => {
    const result = new Result({ title: "Empty", output: "" })
    const formatted = convertToolResult(result)
    assert.equal(formatted, "Empty\n---\n")
  })
})
