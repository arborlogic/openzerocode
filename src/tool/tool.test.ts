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
import { EditTool } from "./edit"
import { WebFetchTool } from "./web-fetch"
import { GrepTool } from "./grep"
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

  it("grep: finds matches without leaking shell errors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ozc-test-"))
    const filePath = join(dir, "sample.ts")
    writeFileSync(filePath, "const greeting = 'hello'\nconst target = 'world'\n")
    const grep = await Effect.runPromise(GrepTool)
    const result = await Effect.runPromise(grep.execute({ pattern: "target", path: dir, include: "*.ts" }, testCtx()))
    assert.ok(result.output.includes("sample.ts:2:const target = 'world'"))
    assert.ok(!result.output.includes("command not found"))
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
    assert.ok(ids.includes("edit"))
    assert.ok(ids.includes("web_fetch"))
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

describe("edit tool", () => {
  it("replaces text in file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ozc-test-"))
    const filePath = join(dir, "test.txt")
    writeFileSync(filePath, "hello world foo")
    const edit = await Effect.runPromise(EditTool)
    const result = await Effect.runPromise(edit.execute({ filePath, oldString: "world", newString: "there", replaceAll: false }, testCtx()))
    assert.equal(result.title, "Edited")
    assert.equal(readFileSync(filePath, "utf-8"), "hello there foo")
  })

  it("replaceAll replaces all occurrences", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ozc-test-"))
    const filePath = join(dir, "test.txt")
    writeFileSync(filePath, "a b a c a")
    const edit = await Effect.runPromise(EditTool)
    const result = await Effect.runPromise(edit.execute({ filePath, oldString: "a", newString: "x", replaceAll: true }, testCtx()))
    assert.equal(result.title, "Edited")
    assert.equal(readFileSync(filePath, "utf-8"), "x b x c x")
  })

  it("returns error when oldString not found", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ozc-test-"))
    const filePath = join(dir, "test.txt")
    writeFileSync(filePath, "hello world")
    const edit = await Effect.runPromise(EditTool)
    const result = await Effect.runPromise(edit.execute({ filePath, oldString: "zzz", newString: "x", replaceAll: false }, testCtx()))
    assert.equal(result.title, "Error")
    assert.ok(result.output.includes("not found"))
  })
})

describe("web_fetch tool", () => {
  it("fetches a URL", async () => {
    const fetch = await Effect.runPromise(WebFetchTool)
    const result = await Effect.runPromise(fetch.execute({ url: "https://example.com", format: "text" }, testCtx()))
    assert.equal(result.title, "Fetched https://example.com")
    assert.ok(result.output.includes("Example Domain"))
  })
})
