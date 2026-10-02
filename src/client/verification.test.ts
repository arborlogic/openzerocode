import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { inferVerificationCommands, isVerificationCommand, isWorkspaceMutatingTool } from "./verification"

test("recognizes workspace-mutating tools", () => {
  assert.equal(isWorkspaceMutatingTool("edit"), true)
  assert.equal(isWorkspaceMutatingTool("write"), true)
  assert.equal(isWorkspaceMutatingTool("apply_patch"), true)
  assert.equal(isWorkspaceMutatingTool("read"), false)
  assert.equal(isWorkspaceMutatingTool("bash"), false)
})

test("recognizes common verification commands", () => {
  for (const command of ["npm test", "npm run typecheck", "go test ./...", "cargo test", "pytest", "swift test", "flutter analyze"]) {
    assert.equal(isVerificationCommand(command), true, command)
  }
  assert.equal(isVerificationCommand("git status --short"), false)
  assert.equal(isVerificationCommand("ls -la"), false)
})

test("infers bounded repository-aware verification commands", () => {
  const dir = mkdtempSync(join(tmpdir(), "ozc-verify-"))
  writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { typecheck: "tsc --noEmit", test: "tsx --test" } }))
  writeFileSync(join(dir, "go.mod"), "module example.com/demo\n")
  assert.deepEqual(inferVerificationCommands(dir), ["npm run typecheck", "npm test", "go test ./..."])
})
