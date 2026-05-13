import { describe, it } from "node:test"
import assert from "node:assert"
import { mkdtempSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { loadAgentsInstruction } from "./workspace-memory"

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
