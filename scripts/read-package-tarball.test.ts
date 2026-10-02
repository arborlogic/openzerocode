import assert from "node:assert/strict"
import { it } from "node:test"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { execFileSync, spawnSync } from "node:child_process"

const script = resolve(import.meta.dirname, "read-package-tarball.mjs")

it("reads platform metadata from the tarball rather than the current project", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "openzerocode-tarball-"))
  try {
    await mkdir(join(workspace, "package"))
    await writeFile(join(workspace, "package/package.json"), JSON.stringify({ name: "@openzerocode/linux-x64", version: "0.9.0" }))
    const archive = join(workspace, "platform.tgz")
    execFileSync("tar", ["-czf", archive, "-C", workspace, "package"])
    assert.equal(execFileSync("node", [script, archive, "name"], { encoding: "utf8" }).trim(), "@openzerocode/linux-x64")
    assert.equal(execFileSync("node", [script, archive, "version"], { encoding: "utf8" }).trim(), "0.9.0")
    await writeFile(join(workspace, "package/package.json"), JSON.stringify({ name: "@openzerocode/linux-x64" }))
    execFileSync("tar", ["-czf", archive, "-C", workspace, "package"])
    assert.notEqual(spawnSync("node", [script, archive, "version"]).status, 0)
    assert.notEqual(spawnSync("node", [script, archive, "invalid"]).status, 0)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
