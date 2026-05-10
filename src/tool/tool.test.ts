import { describe, it } from "node:test"
import assert from "node:assert"
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { Effect, Schema } from "effect"
import { Def, Context, Result } from "./types"
import { ReadTool } from "./read"
import { WriteTool } from "./write"
import { BashTool } from "./bash"
import { ToolRegistry, layer } from "./registry"

function testCtx(): Context {
  return new Context({
    abort: new AbortController().signal,
    cwd: process.cwd(),
    root: process.cwd(),
    ask: () => Effect.void,
    metadata: () => Effect.void,
  })
}

describe("tool", () => {
  it("read: nonexistent file returns error result", async () => {
    const read = await Effect.runPromise(ReadTool)
    const result = await Effect.runPromise(read.execute({ filePath: "/nonexistent_xyz_123" }, testCtx()))
    assert.ok(result.output.startsWith("File not found"))
  })

  it("read: existing file returns content", async () => {
    const read = await Effect.runPromise(ReadTool)
    const result = await Effect.runPromise(read.execute({ filePath: import.meta.filename }, testCtx()))
    assert.ok(result.output.length > 0)
    assert.ok(!result.output.startsWith("File not found"))
  })

  it("bash: echo returns output", async () => {
    const bash = await Effect.runPromise(BashTool)
    const result = await Effect.runPromise(bash.execute({ command: "echo hello" }, testCtx()))
    assert.equal(result.output.trim(), "hello")
  })

  it("write: creates file with content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ozc-test-"))
    const filePath = join(dir, "test.txt")
    const write = await Effect.runPromise(WriteTool)
    await Effect.runPromise(write.execute({ filePath, content: "hello world" }, testCtx()))
    assert.ok(existsSync(filePath))
    assert.equal(readFileSync(filePath, "utf-8"), "hello world")
  })

  it("write: overwrites existing file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ozc-test-"))
    const filePath = join(dir, "test.txt")
    writeFileSync(filePath, "old content")
    const write = await Effect.runPromise(WriteTool)
    await Effect.runPromise(write.execute({ filePath, content: "new content" }, testCtx()))
    assert.equal(readFileSync(filePath, "utf-8"), "new content")
  })
})

describe("registry", () => {
  it("resolves builtin tools", async () => {
    const registry = await Effect.runPromise(
      Effect.gen(function* () {
        const r = yield* ToolRegistry
        return r
      }).pipe(Effect.provide(layer))
    )
    const all = await Effect.runPromise(registry.all())
    const ids = all.map((t) => t.id)
    assert.ok(ids.includes("read"))
    assert.ok(ids.includes("write"))
    assert.ok(ids.includes("bash"))
    assert.ok(ids.includes("grep"))
    assert.ok(ids.includes("glob"))
  })

  it("register adds custom tool", async () => {
    const registry = await Effect.runPromise(
      Effect.gen(function* () {
        const r = yield* ToolRegistry
        return r
      }).pipe(Effect.provide(layer))
    )
    await Effect.runPromise(
      registry.register(new Def({
        id: "custom",
        description: "custom tool",
        parameters: Schema.Struct({}),
        execute: () => Effect.succeed(new Result({ title: "Custom", output: "ok" })),
      }))
    )
    const all = await Effect.runPromise(registry.all())
    const custom = all.find((t) => t.id === "custom")
    assert.ok(custom)
  })
})
