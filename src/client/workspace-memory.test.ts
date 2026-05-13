import { describe, it } from "node:test"
import assert from "node:assert"
import { mkdtempSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { loadWorkspaceMemory, resolveWorkspaceWritePaths } from "./workspace-memory"

function makeTempWorkspace() {
  return mkdtempSync(join(tmpdir(), "ozc-workspace-memory-"))
}

describe("loadWorkspaceMemory", () => {
  it("returns empty context when no files are present", () => {
    const dir = makeTempWorkspace()
    const result = loadWorkspaceMemory(dir)

    assert.equal(result.agentsPath, undefined)
    assert.equal(result.sessionSummaryPath, undefined)
    assert.equal(result.contextBlock, undefined)
  })

  it("loads AGENTS.md from the nearest parent directory", () => {
    const root = makeTempWorkspace()
    const nested = join(root, "src", "routes")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, "package.json"), "{}\n")
    writeFileSync(join(root, "AGENTS.md"), "- This repo uses pnpm.\n")

    const result = loadWorkspaceMemory(nested)

    assert.equal(result.agentsPath, join(root, "AGENTS.md"))
    assert.equal(result.agentsContent, "- This repo uses pnpm.")
    assert.ok(result.contextBlock?.includes("## Stable Instructions from AGENTS.md"))
    assert.ok(result.contextBlock?.includes("- This repo uses pnpm."))
  })

  it("loads SESSION_SUMMARY.md from the nearest parent directory", () => {
    const root = makeTempWorkspace()
    const nested = join(root, "src", "handlers")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, "package.json"), "{}\n")
    writeFileSync(join(root, "SESSION_SUMMARY.md"), "## Goal\n- Add login API.\n")

    const result = loadWorkspaceMemory(nested)

    assert.equal(result.sessionSummaryPath, join(root, "SESSION_SUMMARY.md"))
    assert.equal(result.sessionSummaryContent, "## Goal\n- Add login API.")
    assert.ok(result.contextBlock?.includes("## Recent Session Summary from SESSION_SUMMARY.md"))
    assert.ok(result.contextBlock?.includes("## Goal"))
  })

  it("prefers the nearest matching file when multiple parents contain AGENTS.md", () => {
    const root = makeTempWorkspace()
    const subdir = join(root, "packages", "app")
    const nested = join(subdir, "src")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, "package.json"), "{}\n")
    writeFileSync(join(root, "AGENTS.md"), "- root instruction\n")
    writeFileSync(join(subdir, "AGENTS.md"), "- package instruction\n")

    const result = loadWorkspaceMemory(nested)

    assert.equal(result.agentsPath, join(subdir, "AGENTS.md"))
    assert.equal(result.agentsContent, "- package instruction")
    assert.ok(!result.contextBlock?.includes("- root instruction"))
  })

  it("combines AGENTS.md and SESSION_SUMMARY.md into one workspace context block", () => {
    const root = makeTempWorkspace()
    writeFileSync(join(root, "AGENTS.md"), "- Run tests with `pnpm test`.\n")
    writeFileSync(join(root, "SESSION_SUMMARY.md"), "## Next Steps\n- Add integration tests.\n")

    const result = loadWorkspaceMemory(root)

    assert.ok(result.contextBlock?.startsWith("# Workspace Context"))
    assert.ok(result.contextBlock?.includes("## Stable Instructions from AGENTS.md"))
    assert.ok(result.contextBlock?.includes("## Recent Session Summary from SESSION_SUMMARY.md"))
    assert.ok(result.contextBlock?.includes("- Run tests with `pnpm test`."))
    assert.ok(result.contextBlock?.includes("- Add integration tests."))
  })

  it("writes new workspace files at the workspace boundary when started in a nested directory", () => {
    const root = makeTempWorkspace()
    const nested = join(root, "src", "client")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, "package.json"), "{}\n")

    const result = resolveWorkspaceWritePaths(nested)

    assert.equal(result.workspaceDir, root)
    assert.equal(result.agentsPath, join(root, "AGENTS.md"))
    assert.equal(result.sessionSummaryPath, join(root, "SESSION_SUMMARY.md"))
  })
})
