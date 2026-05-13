import { describe, it } from "node:test"
import assert from "node:assert"
import { buildSystemPrompt } from "./system-prompt"

describe("buildSystemPrompt", () => {
  it("includes build-mode execution guidance", () => {
    const prompt = buildSystemPrompt("build")

    assert.match(prompt, /In Build mode, default to doing the work instead of only describing it\./)
    assert.match(prompt, /You are currently in Build mode\./)
    assert.match(prompt, /Unless the user explicitly asks for analysis, explanation, brainstorming, or a plan/)
    assert.match(prompt, /do not stop at a proposal; make the change in the workspace\./)
  })

  it("includes plan-mode restrictions", () => {
    const prompt = buildSystemPrompt("plan")

    assert.match(prompt, /You are currently in Plan mode\./)
    assert.match(prompt, /Do not write code, do not call tools, and do not make changes\./)
  })

  it("appends AGENTS instructions when present", () => {
    const prompt = buildSystemPrompt("build", "- Run typecheck.\n")

    assert.match(prompt, /Workspace Instructions from AGENTS\.md/)
    assert.match(prompt, /Run typecheck\./)
  })
})
