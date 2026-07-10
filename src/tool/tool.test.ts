import { describe, it } from "node:test"
import assert from "node:assert"
import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { Effect, Schema } from "effect"
import { Def, Context, Result } from "./types"
import { ReadTool } from "./read"
import { WriteTool } from "./write"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { ApplyPatchTool } from "./apply-patch"
import { WebFetchTool } from "./web-fetch"
import { GrepTool } from "./grep"
import { ToolRegistry, layer } from "./registry"
import { GlobTool } from "./glob"

function testCtx(cwd = process.cwd()): Context {
  return new Context({
    abort: new AbortController().signal,
    cwd,
    root: cwd,
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

  it("bash: timeout preserves partial output", async () => {
    const bash = await Effect.runPromise(BashTool)
    const result = await Effect.runPromise(
      bash.execute({ command: "printf 'before timeout\\n'; sleep 2; printf 'after timeout\\n'", timeout: 1000 }, testCtx()),
    )
    assert.ok(result.title.startsWith("Bash error:"))
    assert.ok(result.output.toLowerCase().includes("timed out") || result.output.includes("ETIMEDOUT"))
    assert.ok(result.output.includes("before timeout"))
    assert.ok(!result.output.includes("after timeout"))
  })

  it("bash: clamps tiny timeouts so fast commands are not killed before startup", async () => {
    const bash = await Effect.runPromise(BashTool)
    const result = await Effect.runPromise(bash.execute({ command: "echo hello", timeout: 1 }, testCtx()))
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

  it("grep: resolves relative path and nested include from ctx.cwd", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "ozc-grep-session-"))
    const nestedDir = join(sessionDir, "src", "nested")
    const nestedFile = join(nestedDir, "sample.ts")
    mkdirSync(nestedDir, { recursive: true })
    writeFileSync(nestedFile, "const alpha = 1\nconst needle = 2\n", { encoding: "utf-8", flag: "w" })
    const grep = await Effect.runPromise(GrepTool)
    const result = await Effect.runPromise(grep.execute({ pattern: "needle", path: ".", include: "src/**/*.ts" }, testCtx(sessionDir)))
    assert.ok(result.output.includes("sample.ts:2:const needle = 2"))
  })

  it("grep: supports multiple patterns with include filtering", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "ozc-grep-multi-"))
    const srcDir = join(sessionDir, "src")
    const scriptsDir = join(sessionDir, "scripts")
    mkdirSync(srcDir, { recursive: true })
    mkdirSync(scriptsDir, { recursive: true })
    writeFileSync(join(srcDir, "alpha.ts"), "const alpha = 1\nconst beta = 2\n", { encoding: "utf-8", flag: "w" })
    writeFileSync(join(srcDir, "gamma.ts"), "const gamma = 3\n", { encoding: "utf-8", flag: "w" })
    writeFileSync(join(scriptsDir, "gamma.js"), "const gamma = 4\n", { encoding: "utf-8", flag: "w" })
    writeFileSync(join(sessionDir, "README.md"), "alpha should not be matched here\n", { encoding: "utf-8", flag: "w" })

    const grep = await Effect.runPromise(GrepTool)
    const result = await Effect.runPromise(
      grep.execute({ pattern: ["alpha", "gamma"], path: ".", include: "src/*.ts" }, testCtx(sessionDir)),
    )

    assert.ok(result.output.includes("alpha.ts:1:const alpha = 1"), result.output)
    assert.ok(result.output.includes("gamma.ts:1:const gamma = 3"), result.output)
    assert.ok(!result.output.includes("gamma.js"), result.output)
    assert.ok(!result.output.includes("README.md"), result.output)
  })

  it("glob: resolves relative path and matches nested patterns from ctx.cwd", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "ozc-glob-session-"))
    const nestedDir = join(sessionDir, "src", "nested")
    const nestedFile = join(nestedDir, "sample.ts")
    mkdirSync(nestedDir, { recursive: true })
    writeFileSync(nestedFile, "export const value = 1\n", { encoding: "utf-8", flag: "w" })
    const glob = await Effect.runPromise(GlobTool)
    const result = await Effect.runPromise(glob.execute({ pattern: "src/**/*.ts", path: "." }, testCtx(sessionDir)))
    assert.ok(result.output.includes(nestedFile))
  })

  it("glob: supports multiple patterns and deduplicates overlapping matches", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "ozc-glob-multi-"))
    const srcDir = join(sessionDir, "src")
    const nestedDir = join(srcDir, "nested")
    mkdirSync(nestedDir, { recursive: true })
    const alphaFile = join(srcDir, "alpha.ts")
    const betaFile = join(nestedDir, "beta.ts")
    writeFileSync(alphaFile, "export const alpha = 1\n", { encoding: "utf-8", flag: "w" })
    writeFileSync(betaFile, "export const beta = 2\n", { encoding: "utf-8", flag: "w" })

    const glob = await Effect.runPromise(GlobTool)
    const result = await Effect.runPromise(
      glob.execute({ pattern: ["src/*.ts", "src/nested/*.ts"], path: "." }, testCtx(sessionDir)),
    )

    const lines = result.output.split("\n")
    assert.ok(lines.includes(alphaFile))
    assert.ok(lines.includes(betaFile))
    assert.equal(lines.filter((line) => line === betaFile).length, 1)
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

  it("write/read/edit/bash resolve relative paths from ctx.cwd", async () => {
    const sessionDir = mkdtempSync(join(tmpdir(), "ozc-session-"))
    const outsideDir = mkdtempSync(join(tmpdir(), "ozc-outside-"))
    const ctx = testCtx(sessionDir)

    const write = await Effect.runPromise(WriteTool)
    await Effect.runPromise(write.execute({ filePath: "nested/test.txt", content: "alpha beta" }, ctx))
    assert.ok(existsSync(join(sessionDir, "nested", "test.txt")))
    assert.ok(!existsSync(join(outsideDir, "nested", "test.txt")))

    const read = await Effect.runPromise(ReadTool)
    const readResult = await Effect.runPromise(read.execute({ filePath: "nested/test.txt" }, ctx))
    assert.equal(readResult.output, "alpha beta")

    const edit = await Effect.runPromise(EditTool)
    await Effect.runPromise(edit.execute({ filePath: "nested/test.txt", oldString: "beta", newString: "gamma", replaceAll: false }, ctx))
    assert.equal(readFileSync(join(sessionDir, "nested", "test.txt"), "utf-8"), "alpha gamma")

    const bash = await Effect.runPromise(BashTool)
    const bashResult = await Effect.runPromise(bash.execute({ command: "pwd && test -f nested/test.txt && echo ok" }, ctx))
    const lines = bashResult.output.split("\n")
    assert.ok(lines[0].endsWith(sessionDir) || sessionDir.endsWith(lines[0]))
    assert.equal(lines.at(-1), "ok")
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
    assert.ok(ids.includes("apply_patch"))
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

describe("apply_patch tool", () => {
  it("applies patch-style updates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ozc-test-"))
    const filePath = join(dir, "test.txt")
    writeFileSync(filePath, "hello world\nunchanged\n")
    const patch = await Effect.runPromise(ApplyPatchTool)
    const result = await Effect.runPromise(patch.execute({ patchText: `*** Begin Patch
*** Update File: test.txt
@@
-hello world
+hello there
 unchanged
*** End Patch` }, testCtx(dir)))
    assert.equal(result.title, "Patch Applied")
    assert.equal(readFileSync(filePath, "utf-8"), "hello there\nunchanged\n")
  })

  it("adds files with patch-style syntax", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ozc-test-"))
    const patch = await Effect.runPromise(ApplyPatchTool)
    await Effect.runPromise(patch.execute({ patchText: `*** Begin Patch
*** Add File: nested/new.txt
+alpha
+beta
*** End Patch` }, testCtx(dir)))
    assert.equal(readFileSync(join(dir, "nested", "new.txt"), "utf-8"), "alpha\nbeta\n")
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
