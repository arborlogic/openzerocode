import { describe, it } from "node:test"
import assert from "node:assert"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { findSkill, listSkills, matchSkillByUrl, resolveSkillDirs } from "./skill-loader"

function makeTempWorkspace() {
  return mkdtempSync(join(tmpdir(), "ozc-skill-loader-"))
}

function withHome<T>(home: string, fn: () => T): T {
  const previousHome = process.env.HOME
  const previousSkillsDir = process.env.GEASS_SKILLS_DIR
  process.env.HOME = home
  delete process.env.GEASS_SKILLS_DIR
  try {
    return fn()
  } finally {
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
    if (previousSkillsDir === undefined) delete process.env.GEASS_SKILLS_DIR
    else process.env.GEASS_SKILLS_DIR = previousSkillsDir
  }
}

function writeSkill(root: string, name: string, match: string, body: string) {
  const dir = join(root, "skills", name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, "SKILL.md"),
    ["---", `name: ${name}`, "description: test skill", "match:", match, "---", "", body, ""].join("\n"),
  )
  return dir
}

describe("resolveSkillDirs", () => {
  it("returns project skills before user-global skills", () => {
    const root = makeTempWorkspace()
    const home = makeTempWorkspace()
    mkdirSync(join(root, "skills"), { recursive: true })
    mkdirSync(join(home, ".openzerocode", "skills"), { recursive: true })

    const dirs = withHome(home, () => resolveSkillDirs(root))

    assert.equal(dirs[0], join(root, "skills"))
    assert.equal(dirs[1], join(home, ".openzerocode", "skills"))
  })
})

describe("matchSkillByUrl", () => {
  it("matches skills across multiple directories", () => {
    const root = makeTempWorkspace()
    const home = makeTempWorkspace()
    const projectSkills = join(root, "skills")
    const globalSkills = join(home, ".openzerocode", "skills")
    mkdirSync(projectSkills, { recursive: true })
    writeSkill(join(home, ".openzerocode"), "global-docs", "  domains: [docs.example.com]", "GLOBAL DOCS BODY")

    const skill = matchSkillByUrl("https://docs.example.com/reference", [projectSkills, globalSkills])

    assert.equal(skill?.name, "global-docs")
    assert.equal(skill?.matchedBy, "domains")
    assert.match(skill?.body ?? "", /GLOBAL DOCS BODY/)
  })

  it("prefers project matches when project and user-global skills both match", () => {
    const root = makeTempWorkspace()
    const home = makeTempWorkspace()
    writeSkill(root, "project-docs", "  domains: [docs.example.com]", "PROJECT DOCS BODY")
    writeSkill(join(home, ".openzerocode"), "global-docs", "  domains: [docs.example.com]", "GLOBAL DOCS BODY")

    const skill = matchSkillByUrl("https://docs.example.com/reference", [
      join(root, "skills"),
      join(home, ".openzerocode", "skills"),
    ])

    assert.equal(skill?.name, "project-docs")
    assert.match(skill?.body ?? "", /PROJECT DOCS BODY/)
  })
})

describe("skill discovery", () => {
  it("marks skills shipped in the bundled skills directory as built-in", () => {
    const skills = listSkills([join(process.cwd(), "skills")])

    assert.ok(skills.length > 0)
    assert.ok(skills.every((skill) => skill.isBuiltin))
  })

  it("discovers the bundled commit-helper skill", () => {
    const skills = listSkills([join(process.cwd(), "skills")])
    const commitHelper = skills.find((skill) => skill.name === "commit-helper")

    assert.deepEqual(commitHelper, {
      name: "commit-helper",
      description:
        "Smart git commit message generator following Conventional Commits. Use when the user says 'commit', 'commit this', 'write a commit message', 'smart commit', or asks to create a git commit.",
      skillPath: join(process.cwd(), "skills", "commit-helper", "SKILL.md"),
      isBuiltin: true,
    })
  })

  it("discovers the bundled review-helper skill", () => {
    const skills = listSkills([join(process.cwd(), "skills")])
    const reviewHelper = skills.find((skill) => skill.name === "review-helper")

    assert.deepEqual(reviewHelper, {
      name: "review-helper",
      description:
        "Perform a focused, evidence-based code review. Use when the user asks to review code, a diff, pull request, branch, commit, or implementation before merging.",
      skillPath: join(process.cwd(), "skills", "review-helper", "SKILL.md"),
      isBuiltin: true,
    })
  })

  it("lists nested skills and lets an earlier directory override by name", () => {
    const root = makeTempWorkspace()
    const global = makeTempWorkspace()
    writeSkill(root, "project-docs", "  domains: [docs.example.com]", "PROJECT DOCS BODY")
    const nested = join(root, "skills", "compose", "ask")
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, "SKILL.md"), "---\nname: compose:ask\ndescription: Ask for decisions\n---\nASK BODY\n")
    writeSkill(global, "project-docs", "  domains: [docs.example.com]", "GLOBAL DOCS BODY")

    const dirs = [join(root, "skills"), join(global, "skills")]
    const skills = listSkills(dirs)
    assert.deepEqual(skills.map((skill) => skill.name), ["compose:ask", "project-docs"])
    assert.ok(skills.every((skill) => !skill.isBuiltin))
    assert.equal(findSkill("compose:ask", dirs)?.body.trim(), "ASK BODY")
    assert.match(findSkill("project-docs", dirs)?.body ?? "", /PROJECT DOCS BODY/)
  })
})
