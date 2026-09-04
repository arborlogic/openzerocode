import { describe, it } from "node:test"
import assert from "node:assert"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { buildSystemPrompt, shouldAppendSkillInstructions } from "./system-prompt"

function makeTempWorkspace() {
  return mkdtempSync(join(tmpdir(), "ozc-system-prompt-"))
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

function writeComposeSkill(root: string, name: string, body: string) {
  const dir = join(root, "skills", "compose", name)
  const skillPath = join(dir, "SKILL.md")
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    skillPath,
    ["---", `name: compose:${name}`, `description: ${name} description`, "---", "", body, ""].join("\n"),
  )
  return skillPath
}

describe("buildSystemPrompt", () => {
  it("disables appended skill instructions in Lite mode", () => {
    assert.strictEqual(shouldAppendSkillInstructions("lite"), false)
    assert.strictEqual(shouldAppendSkillInstructions("productive"), true)
  })

  it("builds a compact Lite worker prompt without product workflows or optional context", () => {
    const prompt = buildSystemPrompt(
      "build",
      "- Run focused tests.\n",
      "This optional background must not be injected.\n",
      "/tmp/lite-project",
      "lite",
    )

    assert.match(prompt, /You are the local worker for a coding task\./)
    assert.match(prompt, /# Loop/)
    assert.match(prompt, /Working directory: \/tmp\/lite-project/)
    assert.match(prompt, /Workspace Instructions \(truncated for Lite mode\)/)
    assert.match(prompt, /Run focused tests\./)
    assert.doesNotMatch(prompt, /Task List \(todowrite tool\)/)
    assert.doesNotMatch(prompt, /Compose Skills/)
    assert.doesNotMatch(prompt, /GEASS Browser/)
    assert.doesNotMatch(prompt, /This optional background must not be injected/)
  })

  it("bounds workspace instructions in Lite mode", () => {
    const instructions = "x".repeat(4_100)
    const prompt = buildSystemPrompt("build", instructions, undefined, "/tmp/lite-project", "lite")

    assert.ok(prompt.length < 5_500)
    assert.doesNotMatch(prompt, new RegExp(`x{${4_001}}`))
  })

  it("rejects Compose mode in the Lite harness", () => {
    assert.throws(
      () => buildSystemPrompt("compose", undefined, undefined, process.cwd(), "lite"),
      /Lite harness does not support Compose mode/,
    )
  })

  it("includes build-mode execution guidance", () => {
    const prompt = buildSystemPrompt("build")

    assert.match(prompt, /In Build mode, default to doing the work instead of only describing it\./)
    assert.match(prompt, /You are currently in Build mode\./)
    assert.match(prompt, /Unless the user explicitly asks for analysis, explanation, brainstorming, or a plan/)
    assert.match(prompt, /execute in the same turn instead of stopping at a proposal/)
    assert.match(prompt, /Drive the task to completion/)
    assert.match(prompt, /Do not ask the user whether to continue/)
    assert.match(prompt, /Reporting when done/)
    assert.match(prompt, /smallest complete change that fixes the root cause/)
    assert.match(prompt, /Never claim success without fresh command results/)
    assert.match(prompt, /Do not overwrite or revert unrelated user changes/)
  })

  it("includes an environment section with the working directory", () => {
    const prompt = buildSystemPrompt("build", undefined, undefined, "/tmp/example-project")

    assert.match(prompt, /# Environment/)
    assert.match(prompt, /Working directory: \/tmp\/example-project/)
    assert.match(prompt, /Platform: /)
  })

  it("includes plan-mode restrictions", () => {
    const prompt = buildSystemPrompt("plan")

    assert.match(prompt, /You are currently in Plan mode\./)
    assert.match(prompt, /You may inspect the project with read-only tools/)
    assert.match(prompt, /Do not write code, edit files, apply patches, run shell commands, commit changes/)
  })

  it("includes compose-mode structured workflow guidance", () => {
    const prompt = buildSystemPrompt("compose")

    assert.match(prompt, /You are currently in Compose mode\./)
    assert.match(prompt, /specs-driven development/)
    assert.match(prompt, /compose:brainstorm/)
    assert.match(prompt, /compose:plan/)
    assert.match(prompt, /compose:tdd/)
    assert.match(prompt, /compose:verify/)
    assert.match(prompt, /ordered, sufficiently detailed TODO list or implementation plan/)
    assert.match(prompt, /without asking for routine confirmation, progress updates, per-task reviews/)
    assert.match(prompt, /Once all approved implementation tasks are complete, run integrated verification and one focused final review/)
    assert.doesNotMatch(prompt, /# Task List \(todowrite tool\)/)
  })

  it("appends AGENTS instructions when present", () => {
    const prompt = buildSystemPrompt("build", "- Run typecheck.\n")

    assert.match(prompt, /Workspace Instructions from AGENTS\.md/)
    assert.match(prompt, /Run typecheck\./)
  })

  it("appends CONTEXT instructions when present", () => {
    const prompt = buildSystemPrompt("build", undefined, "Release context details.\n")

    assert.match(prompt, /Workspace Context from CONTEXT\.md/)
    assert.match(prompt, /Release context details\./)
  })

  it("includes AGENTS before CONTEXT when both are present", () => {
    const prompt = buildSystemPrompt("build", "- Follow repo rules.\n", "Feature rollout notes.\n")

    const agentsIndex = prompt.indexOf("# Workspace Instructions from AGENTS.md")
    const contextIndex = prompt.indexOf("# Workspace Context from CONTEXT.md")
    assert.ok(agentsIndex >= 0)
    assert.ok(contextIndex >= 0)
    assert.ok(agentsIndex < contextIndex)
  })

  it("includes task list instructions in build mode only", () => {
    const buildPrompt = buildSystemPrompt("build")
    const planPrompt = buildSystemPrompt("plan")

    assert.match(buildPrompt, /# Task List \(todowrite tool\)/)
    assert.doesNotMatch(planPrompt, /# Task List \(todowrite tool\)/)
  })

  it("documents native vision priority for analyze_image in build mode", () => {
    const buildPrompt = buildSystemPrompt("build")
    const planPrompt = buildSystemPrompt("plan")

    assert.match(buildPrompt, /# Vision/)
    assert.match(buildPrompt, /attaches the image for direct provider vision analysis/)
    assert.doesNotMatch(planPrompt, /# Vision/)
  })

  it("loads compose skills from the project before user-global skills", () => {
    const root = makeTempWorkspace()
    const home = makeTempWorkspace()
    const projectDir = writeComposeSkill(root, "review", "PROJECT REVIEW BODY")
    writeComposeSkill(join(home, ".openzerocode"), "review", "GLOBAL REVIEW BODY")

    const prompt = withHome(home, () => buildSystemPrompt("compose", undefined, undefined, root))

    assert.match(prompt, /compose:review/)
    assert.match(prompt, /review description/)
    assert.match(prompt, new RegExp(projectDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    assert.doesNotMatch(prompt, /PROJECT REVIEW BODY/)
    assert.doesNotMatch(prompt, /GLOBAL REVIEW BODY/)
  })

  it("falls back to user-global compose skills when a project entry is incomplete", () => {
    const root = makeTempWorkspace()
    const home = makeTempWorkspace()
    mkdirSync(join(root, "skills", "compose", "report"), { recursive: true })
    const globalDir = writeComposeSkill(join(home, ".openzerocode"), "report", "GLOBAL REPORT BODY")

    const prompt = withHome(home, () => buildSystemPrompt("compose", undefined, undefined, root))

    assert.match(prompt, /compose:report/)
    assert.match(prompt, /report description/)
    assert.match(prompt, new RegExp(globalDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    assert.doesNotMatch(prompt, /GLOBAL REPORT BODY/)
  })
})
