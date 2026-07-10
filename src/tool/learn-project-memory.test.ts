import test from "node:test"
import assert from "node:assert"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { Effect } from "effect"
import { LearnProjectMemoryApplyTool } from "./learn-project-memory"
import { Context } from "./types"

async function runTool(cwd: string, args: unknown, asks: any[] = []) {
  const tool = await Effect.runPromise(LearnProjectMemoryApplyTool)
  return Effect.runPromise(tool.execute(args, new Context({
    abort: new AbortController().signal,
    cwd,
    root: cwd,
    ask: (req) => Effect.sync(() => { asks.push(req) }),
    metadata: () => Effect.void,
  })))
}

function tempWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "ozc-learn-project-memory-"))
  writeFileSync(join(dir, "package.json"), "{}\n")
  return dir
}

test("learn_project_memory_apply creates confirmed project DEVELOPMENT.md", async () => {
  const workspace = tempWorkspace()
  const asks: any[] = []

  const result = await runTool(workspace, {
    operation: "append",
    content: "  ## Verification\n- Run npm test.  ",
  }, asks)

  const target = join(workspace, "DEVELOPMENT.md")
  assert.equal(result.title, "Project development memory updated")
  assert.equal(result.output, "Created DEVELOPMENT.md")
  assert.equal(readFileSync(target, "utf-8"), "## Verification\n- Run npm test.\n")
  assert.deepEqual(asks, [{ permission: "learn-project-memory", patterns: [target], metadata: { operation: "append" } }])
})

test("learn_project_memory_apply appends to existing DEVELOPMENT.md", async () => {
  const workspace = tempWorkspace()
  const target = join(workspace, "DEVELOPMENT.md")
  writeFileSync(target, "# Development\n")

  const result = await runTool(workspace, {
    operation: "append",
    content: "Use targeted tests after focused edits.",
  })

  assert.equal(result.output, "Appended to DEVELOPMENT.md")
  assert.equal(readFileSync(target, "utf-8"), "# Development\n\nUse targeted tests after focused edits.\n")
})

test("learn_project_memory_apply replaces existing DEVELOPMENT.md", async () => {
  const workspace = tempWorkspace()
  const target = join(workspace, "DEVELOPMENT.md")
  writeFileSync(target, "Old notes.\n")

  const result = await runTool(workspace, {
    operation: "replace",
    content: "New project guidance.",
  })

  assert.equal(result.output, "Replaced DEVELOPMENT.md")
  assert.equal(readFileSync(target, "utf-8"), "New project guidance.\n")
})

test("learn_project_memory_apply writes at workspace boundary from nested cwd", async () => {
  const workspace = tempWorkspace()
  const nested = join(workspace, "packages", "app")
  mkdirSync(nested, { recursive: true })

  await runTool(nested, {
    operation: "append",
    content: "Project-specific architecture note.",
  })

  assert.equal(existsSync(join(workspace, "DEVELOPMENT.md")), true)
  assert.equal(existsSync(join(nested, "DEVELOPMENT.md")), false)
})
