import { describe, it } from "node:test"
import assert from "node:assert"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRecoveryCheckpoint, finalizeRecoveryCheckpoint, formatRecoveryCheckpoint, restoreRecoveryCheckpoint, type RecoveryCheckpoint } from "./recovery"
import { saveExperiments } from "../client/experiments"

function tempCheckpoint(cwd: string, patch: Partial<RecoveryCheckpoint> = {}): RecoveryCheckpoint {
  const id = patch.id ?? "20260522024052565-testcheckpoint"
  mkdirSync(join(cwd, ".openzerocode", "recovery", id), { recursive: true })
  return {
    id,
    timestamp: patch.timestamp ?? "2026-05-22T02:40:52.566Z",
    cwd,
    filePath: patch.filePath ?? "test.txt",
    target: patch.target ?? join(cwd, "test.txt"),
    operation: patch.operation ?? "write",
    existed: patch.existed ?? false,
    contentPath: patch.contentPath,
    beforeContentPath: patch.beforeContentPath,
    existsAfter: patch.existsAfter,
  }
}

describe("recovery", () => {
  it("groups multiple changed files into one restorable checkpoint", async () => {
    saveExperiments({ lightweightRecovery: true })
    const cwd = await mkdtemp(join(tmpdir(), "ozc-recovery-"))
    const cargo = join(cwd, "Cargo.toml")
    const main = join(cwd, "src", "main.rs")
    mkdirSync(join(cwd, "src"), { recursive: true })

    const first = await createRecoveryCheckpoint({ cwd, filePath: "src/main.rs", target: main, operation: "write", groupId: "tool-a:tool-b" })
    writeFileSync(main, "fn main() {}\n")
    await finalizeRecoveryCheckpoint(first, main)

    const second = await createRecoveryCheckpoint({ cwd, filePath: "Cargo.toml", target: cargo, operation: "write", groupId: "tool-a:tool-b" })
    writeFileSync(cargo, "[package]\nname = \"hello\"\n")
    await finalizeRecoveryCheckpoint(second, cargo)

    assert.equal(first?.id, second?.id)
    const manifestPath = join(cwd, ".openzerocode", "recovery", first!.id, "manifest.json")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as RecoveryCheckpoint
    assert.equal(manifest.files?.length, 2)
    assert.deepEqual(manifest.files?.map((file) => file.filePath).sort(), ["Cargo.toml", "src/main.rs"])
    assert.equal(readFileSync(join(cwd, ".openzerocode", "recovery", first!.id, "files", "0.after"), "utf-8"), "fn main() {}\n")
    assert.equal(readFileSync(join(cwd, ".openzerocode", "recovery", first!.id, "files", "1.after"), "utf-8"), "[package]\nname = \"hello\"\n")

    writeFileSync(main, "broken")
    writeFileSync(cargo, "broken")
    const result = await restoreRecoveryCheckpoint(cwd, first!.id)
    assert.equal(result.ok, true)
    assert.equal(readFileSync(main, "utf-8"), "fn main() {}\n")
    assert.equal(readFileSync(cargo, "utf-8"), "[package]\nname = \"hello\"\n")
    assert.ok(formatRecoveryCheckpoint(manifest).includes("batch"))
  })


  it("finalizes and restores a checkpoint for a newly created file", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "ozc-recovery-"))
    const target = join(cwd, "Cargo.toml")
    const checkpoint = tempCheckpoint(cwd, { filePath: "Cargo.toml", target, existed: false })

    writeFileSync(target, "[package]\nname = \"hello\"\n")
    await finalizeRecoveryCheckpoint(checkpoint)

    const manifest = JSON.parse(readFileSync(join(cwd, ".openzerocode", "recovery", checkpoint.id, "manifest.json"), "utf-8")) as RecoveryCheckpoint
    assert.equal(manifest.contentPath, "after")
    assert.equal(manifest.existsAfter, true)
    assert.equal(readFileSync(join(cwd, ".openzerocode", "recovery", checkpoint.id, "after"), "utf-8"), "[package]\nname = \"hello\"\n")

    writeFileSync(target, "broken")
    const result = await restoreRecoveryCheckpoint(cwd, checkpoint.id)
    assert.equal(result.ok, true)
    assert.equal(readFileSync(target, "utf-8"), "[package]\nname = \"hello\"\n")
    assert.ok(formatRecoveryCheckpoint(manifest).includes("checkpoint"))
  })

  it("keeps legacy pre-create checkpoints restorable by removing the file", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "ozc-recovery-"))
    const target = join(cwd, "hello_server.py")
    const checkpoint = tempCheckpoint(cwd, { filePath: "hello_server.py", target, existed: false })
    writeFileSync(join(cwd, ".openzerocode", "recovery", checkpoint.id, "manifest.json"), JSON.stringify(checkpoint, null, 2), "utf-8")
    writeFileSync(target, "print('hello')\n")

    const result = await restoreRecoveryCheckpoint(cwd, checkpoint.id)
    assert.equal(result.ok, true)
    assert.equal(existsSync(target), false)
  })
})
