import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { after, describe, it } from "node:test"
import { access, mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const workspaces: string[] = []

after(async () => {
  await Promise.all(workspaces.map((workspace) => rm(workspace, { recursive: true, force: true })))
})

describe("dev install package", () => {
  it("packs postinstall sources and deploys bundled skills when installed from its tarball", { timeout: 120_000 }, async () => {
    const workspace = await mkdtemp(join(tmpdir(), "openzerocode-dev-install-"))
    workspaces.push(workspace)

    const packOutput = execFileSync("npm", ["pack", "--json", "--pack-destination", workspace], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
    const [{ filename, files }] = JSON.parse(packOutput) as [{ filename: string; files: Array<{ path: string }> }]
    const packagedPaths = files.map((file) => file.path)

    assert.ok(packagedPaths.includes("parsers-config.ts"))
    assert.ok(packagedPaths.includes("skills/commit-helper/SKILL.md"))
    assert.ok(packagedPaths.includes("skills/review-helper/SKILL.md"))

    const installPrefix = join(workspace, "install")
    execFileSync("npm", ["install", "--prefix", installPrefix, "--no-audit", "--no-fund", join(workspace, filename)], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })

    const packageDir = join(installPrefix, "node_modules", "openzerocode")
    await access(join(packageDir, "parsers-config.ts"))
    await access(join(packageDir, "dist", "openzerocode"))
    assert.equal(
      await readFile(join(packageDir, "dist", "bundled-skills", "review-helper", "SKILL.md"), "utf8"),
      await readFile(join(root, "skills", "review-helper", "SKILL.md"), "utf8"),
    )
  })
})
