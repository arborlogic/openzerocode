import assert from "node:assert/strict"
import { after, describe, it } from "node:test"
import { access, cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { replaceBundledSkills } from "./bundled-skills"

const projectRoot = resolve(import.meta.dirname, "..")
const platformPackageDir = join(projectRoot, "npm", "packages", `${process.platform}-${process.arch}`)

const workspaces: string[] = []

after(async () => {
  await Promise.all(workspaces.map((workspace) => rm(workspace, { recursive: true, force: true })))
})

describe("replaceBundledSkills", () => {
  it("removes skills no longer bundled while preserving the sibling user skills directory", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "openzerocode-bundled-skills-"))
    workspaces.push(workspace)

    const source = join(workspace, "release", "bundled-skills")
    const installDir = join(workspace, "install")
    const destination = join(installDir, "bundled-skills")
    const userSkills = join(installDir, "skills")

    await mkdir(join(source, "current"), { recursive: true })
    await writeFile(join(source, "current", "SKILL.md"), "current bundled skill")
    await mkdir(join(destination, "removed"), { recursive: true })
    await writeFile(join(destination, "removed", "SKILL.md"), "stale bundled skill")
    await mkdir(join(userSkills, "mine"), { recursive: true })
    await writeFile(join(userSkills, "mine", "SKILL.md"), "user-managed skill")

    await replaceBundledSkills(source, destination)

    assert.equal(await readFile(join(destination, "current", "SKILL.md"), "utf8"), "current bundled skill")
    await assert.rejects(access(join(destination, "removed", "SKILL.md")))
    assert.equal(await readFile(join(userSkills, "mine", "SKILL.md"), "utf8"), "user-managed skill")
  })

  it("includes bundled skills in the native platform package tarball", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "openzerocode-platform-package-"))
    workspaces.push(workspace)
    const packageDir = join(workspace, "package")

    await cp(platformPackageDir, packageDir, { recursive: true })
    const packed = spawnSync("npm", ["pack", "--json"], { cwd: packageDir, encoding: "utf8" })
    assert.equal(packed.status, 0, packed.stderr)

    const [{ filename }] = JSON.parse(packed.stdout) as Array<{ filename: string }>
    const archive = join(packageDir, filename)
    const listed = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" })
    assert.equal(listed.status, 0, listed.stderr)
    assert.match(listed.stdout, /package\/bin\/bundled-skills\/openzerocode\/SKILL\.md/)
    assert.match(listed.stdout, /package\/bin\/bundled-skills\/review-helper\/SKILL\.md/)
  })
})
