import { describe, it } from "node:test"
import assert from "node:assert"
import { buildSystemPrompt, shouldAppendSkillInstructions } from "./system-prompt"

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
})
