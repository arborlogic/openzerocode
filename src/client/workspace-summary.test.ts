import { describe, it } from "node:test"
import assert from "node:assert"
import { existsSync, mkdtempSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { Message } from "../provider/types"
import { buildSessionSummaryPrompt, writeSessionSummary } from "./workspace-summary"

function makeTempWorkspace() {
  return mkdtempSync(join(tmpdir(), "ozc-workspace-summary-"))
}

describe("workspace summary helpers", () => {
  it("builds a summary prompt from transcript messages", () => {
    const messages: Message[] = [
      { role: "user", content: "Add login API" },
      { role: "assistant", content: "Implemented route and handler." },
    ]

    const prompt = buildSessionSummaryPrompt(messages)

    assert.match(prompt.system, /SESSION_SUMMARY\.md/)
    assert.match(prompt.system, /Relevant Files, use bullets in the format: - path: why it matters\./)
    assert.match(prompt.system, /Do not put routine verification steps, ordinary completed actions, or generic commands into Critical Context unless they represent a non-obvious repo requirement\./)
    assert.match(prompt.system, /For Next Steps, list short action-oriented bullets in likely execution order\./)
    assert.match(prompt.user, /## Goal/)
    assert.match(prompt.user, /## Next Steps/)
    assert.match(prompt.user, /## Critical Context/)
    assert.match(prompt.user, /## Relevant Files/)
    assert.match(prompt.user, /USER:/)
    assert.match(prompt.user, /ASSISTANT:/)
  })

  it("writes a normalized SESSION_SUMMARY.md file", () => {
    const dir = makeTempWorkspace()

    const path = writeSessionSummary("## Goal\n- Add tests.", dir)

    assert.ok(path)
    assert.ok(existsSync(path!))
    assert.equal(
      readFileSync(path!, "utf-8"),
      "# SESSION_SUMMARY.md\n\n## Goal\n- Add tests.\n",
    )
  })
})
