import { describe, it } from "node:test"
import assert from "node:assert"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { ensureGlobalMemoryFiles, formatWorkspaceMemoryStatus, inspectWorkspaceMemory, loadAgentsInstruction, loadContextInstruction } from "./workspace-memory"

function makeTempWorkspace() {
  return mkdtempSync(join(tmpdir(), "ozc-workspace-memory-"))
}

function withHome<T>(home: string, fn: () => T): T {
  const previous = process.env.HOME
  process.env.HOME = home
  try {
    return fn()
  } finally {
    if (previous === undefined) delete process.env.HOME
    else process.env.HOME = previous
  }
}

describe("ensureGlobalMemoryFiles", () => {
  it("creates empty global AGENTS.md and CONTEXT.md on first Learn-mode bootstrap", () => {
    const home = makeTempWorkspace()

    const result = withHome(home, () => ensureGlobalMemoryFiles())

    const agentsPath = join(home, ".openzerocode", "AGENTS.md")
    const contextPath = join(home, ".openzerocode", "CONTEXT.md")
    assert.equal(result.agentsPath, agentsPath)
    assert.equal(result.contextPath, contextPath)
    assert.deepEqual(result.created, [agentsPath, contextPath])
    assert.equal(existsSync(agentsPath), true)
    assert.equal(existsSync(contextPath), true)
    assert.equal(readFileSync(agentsPath, "utf8"), "")
    assert.equal(readFileSync(contextPath, "utf8"), "")
  })

  it("does not overwrite existing global memory files", () => {
    const home = makeTempWorkspace()
    mkdirSync(join(home, ".openzerocode"), { recursive: true })
    const agentsPath = join(home, ".openzerocode", "AGENTS.md")
    const contextPath = join(home, ".openzerocode", "CONTEXT.md")
    writeFileSync(agentsPath, "existing agents\n")
    writeFileSync(contextPath, "existing context\n")

    const result = withHome(home, () => ensureGlobalMemoryFiles())

    assert.deepEqual(result.created, [])
    assert.equal(readFileSync(agentsPath, "utf8"), "existing agents\n")
    assert.equal(readFileSync(contextPath, "utf8"), "existing context\n")
  })

  it("empty bootstrapped global files are not loaded into the prompt", () => {
    const root = makeTempWorkspace()
    const home = makeTempWorkspace()
    writeFileSync(join(root, "package.json"), "{}\n")

    const result = withHome(home, () => {
      ensureGlobalMemoryFiles()
      return {
        agents: loadAgentsInstruction(root),
        context: loadContextInstruction(root),
      }
    })

    assert.equal(result.agents, undefined)
    assert.equal(result.context, undefined)
  })
})

describe("loadAgentsInstruction", () => {
  it("returns undefined when no global AGENTS.md exists", () => {
    const dir = makeTempWorkspace()
    const home = makeTempWorkspace()
    const result = withHome(home, () => loadAgentsInstruction(dir))
    assert.equal(result, undefined)
  })

  it("loads user global AGENTS.md from ~/.openzerocode", () => {
    const root = makeTempWorkspace()
    const home = makeTempWorkspace()
    mkdirSync(join(home, ".openzerocode"), { recursive: true })
    writeFileSync(join(root, "package.json"), "{}\n")
    writeFileSync(join(home, ".openzerocode", "AGENTS.md"), "- Reply in Traditional Chinese.\n")

    const result = withHome(home, () => loadAgentsInstruction(root))

    assert.equal(result, "- Reply in Traditional Chinese.")
  })

  it("ignores project AGENTS.md files", () => {
    const root = makeTempWorkspace()
    const home = makeTempWorkspace()
    mkdirSync(join(root, ".openzerocode"), { recursive: true })
    writeFileSync(join(root, "package.json"), "{}\n")
    writeFileSync(join(root, "AGENTS.md"), "- root instruction\n")
    writeFileSync(join(root, ".openzerocode", "AGENTS.md"), "- project instruction\n")

    const result = withHome(home, () => loadAgentsInstruction(root))

    assert.equal(result, undefined)
  })

  it("returns undefined for an empty global AGENTS.md", () => {
    const root = makeTempWorkspace()
    const home = makeTempWorkspace()
    mkdirSync(join(home, ".openzerocode"), { recursive: true })
    writeFileSync(join(home, ".openzerocode", "AGENTS.md"), "   \n")

    const result = withHome(home, () => loadAgentsInstruction(root))

    assert.equal(result, undefined)
  })

  it("does not auto-load conditional instructions from memory.d", () => {
    const root = makeTempWorkspace()
    const home = makeTempWorkspace()
    mkdirSync(join(home, ".openzerocode", "memory.d"), { recursive: true })
    writeFileSync(join(root, "pubspec.yaml"), "name: app\ndependencies:\n  flutter:\n    sdk: flutter\n")
    writeFileSync(join(home, ".openzerocode", "memory.d", "flutter.md"), [
      "---",
      "type: agents",
      "whenAnyFile:",
      "  - pubspec.yaml",
      "---",
      "Run Flutter verification.",
    ].join("\n"))

    const result = withHome(home, () => loadAgentsInstruction(root))

    assert.equal(result, undefined)
  })
})

describe("loadContextInstruction", () => {
  it("returns undefined when no global CONTEXT.md exists", () => {
    const dir = makeTempWorkspace()
    const home = makeTempWorkspace()
    const result = withHome(home, () => loadContextInstruction(dir))
    assert.equal(result, undefined)
  })

  it("loads user global CONTEXT.md from ~/.openzerocode", () => {
    const root = makeTempWorkspace()
    const home = makeTempWorkspace()
    mkdirSync(join(home, ".openzerocode"), { recursive: true })
    writeFileSync(join(root, "package.json"), "{}\n")
    writeFileSync(join(home, ".openzerocode", "CONTEXT.md"), "User background details.\n")

    const result = withHome(home, () => loadContextInstruction(root))

    assert.equal(result, "User background details.")
  })

  it("ignores project CONTEXT.md files", () => {
    const root = makeTempWorkspace()
    const home = makeTempWorkspace()
    mkdirSync(join(root, ".openzerocode"), { recursive: true })
    writeFileSync(join(root, "package.json"), "{}\n")
    writeFileSync(join(root, "CONTEXT.md"), "Root context.\n")
    writeFileSync(join(root, ".openzerocode", "CONTEXT.md"), "Project context.\n")

    const result = withHome(home, () => loadContextInstruction(root))

    assert.equal(result, undefined)
  })

  it("returns undefined for an empty global CONTEXT.md", () => {
    const root = makeTempWorkspace()
    const home = makeTempWorkspace()
    mkdirSync(join(home, ".openzerocode"), { recursive: true })
    writeFileSync(join(home, ".openzerocode", "CONTEXT.md"), "   \n")

    const result = withHome(home, () => loadContextInstruction(root))

    assert.equal(result, undefined)
  })
})

describe("inspectWorkspaceMemory", () => {
  it("reports global memory files and manual session summary status", () => {
    const root = makeTempWorkspace()
    const home = makeTempWorkspace()
    const nested = join(root, "packages", "app", "src")
    mkdirSync(nested, { recursive: true })
    mkdirSync(join(home, ".openzerocode"), { recursive: true })
    mkdirSync(join(root, ".openzerocode"), { recursive: true })
    writeFileSync(join(root, "package.json"), "{}\n")
    writeFileSync(join(home, ".openzerocode", "AGENTS.md"), "global agents\n")
    writeFileSync(join(root, ".openzerocode", "AGENTS.md"), "project agents\n")
    writeFileSync(join(root, ".openzerocode", "CONTEXT.md"), "project context\n")
    writeFileSync(join(root, "SESSION_SUMMARY.md"), "handoff notes\n")

    const status = withHome(home, () => inspectWorkspaceMemory(nested))

    assert.equal(status.workspaceBoundary, root)
    assert.equal(status.agentsLoaded, true)
    assert.equal(status.contextLoaded, false)
    assert.equal(status.sessionSummaryPresent, true)
    assert.equal(status.sessionSummaryAutomatic, false)
    assert.deepEqual(status.agentsPaths, [join(home, ".openzerocode", "AGENTS.md")])
    assert.deepEqual(status.contextPaths, [])
    assert.equal(status.agentsPath, join(home, ".openzerocode", "AGENTS.md"))
    assert.equal(status.contextPath, undefined)
    assert.equal(status.sessionSummaryPath, join(root, "SESSION_SUMMARY.md"))
  })

  it("formats a readable status summary", () => {
    const root = makeTempWorkspace()
    const home = makeTempWorkspace()
    mkdirSync(join(home, ".openzerocode"), { recursive: true })
    writeFileSync(join(root, "package.json"), "{}\n")
    writeFileSync(join(home, ".openzerocode", "AGENTS.md"), "global rules\n")

    const text = withHome(home, () => formatWorkspaceMemoryStatus(inspectWorkspaceMemory(root)))

    assert.match(text, /Workspace memory status/)
    assert.match(text, /user global AGENTS\.md: loaded/)
    assert.match(text, /project DEVELOPMENT\.md: manual Learn-mode extraction target \(not auto-loaded\)/)
    assert.match(text, /project memory files: not loaded/)
    assert.match(text, /user global CONTEXT\.md: not loaded/)
    assert.match(text, /SESSION_SUMMARY\.md: not present \(and never auto-loaded\)/)
  })
})
