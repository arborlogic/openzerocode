import assert from "node:assert/strict"
import { after, describe, it } from "node:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const workspaces: string[] = []
const installer = resolve(import.meta.dirname, "..", "install")

after(async () => {
  await Promise.all(workspaces.map((workspace) => rm(workspace, { recursive: true, force: true })))
})

describe("install", () => {
  it("replaces bundled skills on upgrade without deleting user-managed skills", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "openzerocode-install-"))
    workspaces.push(workspace)

    const release = join(workspace, "release")
    const binary = join(release, "openzerocode")
    const bundledSkills = join(release, "bundled-skills")
    const installDir = join(workspace, "install")
    await mkdir(join(bundledSkills, "current"), { recursive: true })
    await writeFile(binary, "#!/usr/bin/env bash\n")
    await writeFile(join(bundledSkills, "current", "SKILL.md"), "current bundled skill")

    const runInstaller = () =>
      spawnSync("bash", [installer, "--binary", binary, "--no-modify-path"], {
        env: { ...process.env, HOME: join(workspace, "home"), OPENZEROCODE_INSTALL_DIR: installDir },
        encoding: "utf8",
      })

    assert.equal(runInstaller().status, 0)
    await mkdir(join(installDir, "skills", "mine"), { recursive: true })
    await writeFile(join(installDir, "skills", "mine", "SKILL.md"), "user-managed skill")

    await rm(join(bundledSkills, "current"), { recursive: true })
    await mkdir(join(bundledSkills, "replacement"), { recursive: true })
    await writeFile(join(bundledSkills, "replacement", "SKILL.md"), "replacement bundled skill")

    assert.equal(runInstaller().status, 0)
    assert.equal(await readFile(join(installDir, "bundled-skills", "replacement", "SKILL.md"), "utf8"), "replacement bundled skill")
    await assert.rejects(readFile(join(installDir, "bundled-skills", "current", "SKILL.md")))
    assert.equal(await readFile(join(installDir, "skills", "mine", "SKILL.md"), "utf8"), "user-managed skill")
  })
})
