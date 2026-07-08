import assert from "node:assert/strict"
import test from "node:test"
import { existsSync, mkdtempSync, readFileSync } from "fs"
import { mkdirSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { Effect } from "effect"
import { LearnMemoryApplyTool } from "./learn-memory"
import { Context } from "./types"

async function runTool(cwd: string, args: unknown, asks: any[] = []) {
  const tool = await Effect.runPromise(LearnMemoryApplyTool)
  return Effect.runPromise(tool.execute(args, new Context({
    abort: new AbortController().signal,
    cwd,
    root: cwd,
    ask: (req) => Effect.sync(() => { asks.push(req) }),
    metadata: () => Effect.void,
  })))
}

function tempWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "ozc-learn-memory-"))
  writeFileSync(join(dir, "package.json"), "{}\n")
  return dir
}

function withHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.HOME
  process.env.HOME = home
  return fn().finally(() => {
    if (previous === undefined) delete process.env.HOME
    else process.env.HOME = previous
  })
}

test("learn_memory_apply creates confirmed global AGENTS.md", async () => {
  const workspace = tempWorkspace()
  const home = mkdtempSync(join(tmpdir(), "ozc-learn-home-"))
  const asks: any[] = []

  const result = await withHome(home, () => runTool(workspace, {
    target: "AGENTS.md",
    operation: "append",
    content: "  - Prefer targeted tests.  ",
  }, asks))

  const target = join(home, ".openzerocode", "AGENTS.md")
  assert.equal(result.title, "Learn memory updated")
  assert.equal(result.output, "Created ~/.openzerocode/AGENTS.md")
  assert.equal(readFileSync(target, "utf-8"), "- Prefer targeted tests.\n")
  assert.deepEqual(asks, [{ permission: "learn-memory", patterns: ["~/.openzerocode/AGENTS.md"], metadata: { operation: "append" } }])
})

test("learn_memory_apply appends to existing global CONTEXT.md with a blank line", async () => {
  const workspace = tempWorkspace()
  const home = mkdtempSync(join(tmpdir(), "ozc-learn-home-"))
  const target = join(home, ".openzerocode", "CONTEXT.md")
  mkdirSync(join(home, ".openzerocode"), { recursive: true })
  writeFileSync(target, "Existing context.\n")

  const result = await withHome(home, () => runTool(workspace, {
    target: "CONTEXT.md",
    operation: "append",
    content: "New context.",
  }))

  assert.equal(result.output, "Appended to ~/.openzerocode/CONTEXT.md")
  assert.equal(readFileSync(target, "utf-8"), "Existing context.\n\nNew context.\n")
})

test("learn_memory_apply replaces existing global AGENTS.md", async () => {
  const workspace = tempWorkspace()
  const home = mkdtempSync(join(tmpdir(), "ozc-learn-home-"))
  const target = join(home, ".openzerocode", "AGENTS.md")
  mkdirSync(join(home, ".openzerocode"), { recursive: true })
  writeFileSync(target, "Old global rule.\n")

  const result = await withHome(home, () => runTool(workspace, {
    target: "AGENTS.md",
    operation: "replace",
    content: "Replacement global rule.",
  }))

  assert.equal(result.output, "Replaced ~/.openzerocode/AGENTS.md")
  assert.equal(readFileSync(target, "utf-8"), "Replacement global rule.\n")
})

test("learn_memory_apply rejects unsupported targets before writing", async () => {
  const workspace = tempWorkspace()
  const home = mkdtempSync(join(tmpdir(), "ozc-learn-home-"))

  await assert.rejects(
    () => withHome(home, () => runTool(workspace, {
      target: "README.md",
      operation: "append",
      content: "Nope.",
    })),
    /README\.md/,
  )

  assert.equal(existsSync(join(home, ".openzerocode", "README.md")), false)
})
