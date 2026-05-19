import { describe, it } from "node:test"
import assert from "node:assert"
import { mkdtempSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { formatWorkspaceMemoryStatus, inspectWorkspaceMemory, loadAgentsInstruction, loadContextInstruction } from "./workspace-memory"

function makeTempWorkspace() {
  return mkdtempSync(join(tmpdir(), "ozc-workspace-memory-"))
}

describe("loadAgentsInstruction", () => {
  it("returns undefined when no AGENTS.md exists", () => {
    const dir = makeTempWorkspace()
    const result = loadAgentsInstruction(dir)
    assert.equal(result, undefined)
  })

  it("loads AGENTS.md from the workspace root", () => {
    const root = makeTempWorkspace()
    writeFileSync(join(root, "package.json"), "{}\n")
    writeFileSync(join(root, "AGENTS.md"), "- This repo uses pnpm.\n")

    const result = loadAgentsInstruction(root)

    assert.equal(result, "- This repo uses pnpm.")
  })

  it("finds AGENTS.md by walking up from a nested directory", () => {
    const root = makeTempWorkspace()
    const nested = join(root, "src", "routes")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, "package.json"), "{}\n")
    writeFileSync(join(root, "AGENTS.md"), "- Run tests with bun test.\n")

    const result = loadAgentsInstruction(nested)

    assert.equal(result, "- Run tests with bun test.")
  })

  it("prefers the nearest AGENTS.md when multiple parents have one", () => {
    const root = makeTempWorkspace()
    const subdir = join(root, "packages", "app")
    const nested = join(subdir, "src")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, "package.json"), "{}\n")
    writeFileSync(join(root, "AGENTS.md"), "- root instruction\n")
    writeFileSync(join(subdir, "AGENTS.md"), "- package instruction\n")

    const result = loadAgentsInstruction(nested)

    assert.equal(result, "- package instruction")
  })

  it("returns undefined for an empty AGENTS.md", () => {
    const root = makeTempWorkspace()
    writeFileSync(join(root, "AGENTS.md"), "   \n")

    const result = loadAgentsInstruction(root)

    assert.equal(result, undefined)
  })
})

describe("inspectWorkspaceMemory", () => {
  it("reports nearest memory files and manual session summary status", () => {
    const root = makeTempWorkspace()
    const nested = join(root, "packages", "app", "src")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, "package.json"), "{}\n")
    writeFileSync(join(root, "AGENTS.md"), "root agents\n")
    writeFileSync(join(root, "CONTEXT.md"), "root context\n")
    writeFileSync(join(root, "SESSION_SUMMARY.md"), "handoff notes\n")

    const status = inspectWorkspaceMemory(nested)

    assert.equal(status.workspaceBoundary, root)
    assert.equal(status.agentsLoaded, true)
    assert.equal(status.contextLoaded, true)
    assert.equal(status.sessionSummaryPresent, true)
    assert.equal(status.sessionSummaryAutomatic, false)
    assert.equal(status.agentsPath, join(root, "AGENTS.md"))
    assert.equal(status.contextPath, join(root, "CONTEXT.md"))
    assert.equal(status.sessionSummaryPath, join(root, "SESSION_SUMMARY.md"))
  })

  it("formats a readable status summary", () => {
    const root = makeTempWorkspace()
    writeFileSync(join(root, "package.json"), "{}\n")
    writeFileSync(join(root, "AGENTS.md"), "repo rules\n")

    const text = formatWorkspaceMemoryStatus(inspectWorkspaceMemory(root))

    assert.match(text, /Workspace memory status/)
    assert.match(text, /AGENTS\.md: loaded/)
    assert.match(text, /CONTEXT\.md: not loaded/)
    assert.match(text, /SESSION_SUMMARY\.md: not present \(and never auto-loaded\)/)
  })
})

describe("loadContextInstruction", () => {
  it("returns undefined when no CONTEXT.md exists", () => {
    const dir = makeTempWorkspace()
    const result = loadContextInstruction(dir)
    assert.equal(result, undefined)
  })

  it("loads CONTEXT.md from the workspace root", () => {
    const root = makeTempWorkspace()
    writeFileSync(join(root, "package.json"), "{}\n")
    writeFileSync(join(root, "CONTEXT.md"), "Project background details.\n")

    const result = loadContextInstruction(root)

    assert.equal(result, "Project background details.")
  })

  it("finds CONTEXT.md by walking up from a nested directory", () => {
    const root = makeTempWorkspace()
    const nested = join(root, "src", "routes")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, "package.json"), "{}\n")
    writeFileSync(join(root, "CONTEXT.md"), "Important project context.\n")

    const result = loadContextInstruction(nested)

    assert.equal(result, "Important project context.")
  })

  it("prefers the nearest CONTEXT.md when multiple parents have one", () => {
    const root = makeTempWorkspace()
    const subdir = join(root, "packages", "app")
    const nested = join(subdir, "src")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(root, "package.json"), "{}\n")
    writeFileSync(join(root, "CONTEXT.md"), "root context\n")
    writeFileSync(join(subdir, "CONTEXT.md"), "package context\n")

    const result = loadContextInstruction(nested)

    assert.equal(result, "package context")
  })

  it("returns undefined for an empty CONTEXT.md", () => {
    const root = makeTempWorkspace()
    writeFileSync(join(root, "CONTEXT.md"), "   \n")

    const result = loadContextInstruction(root)

    assert.equal(result, undefined)
  })
})
