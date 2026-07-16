import assert from "node:assert/strict"
import { after, describe, it } from "node:test"
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { replaceBundledSkills } from "./bundled-skills"

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
})
