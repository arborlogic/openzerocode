import { describe, it } from "node:test"
import assert from "node:assert"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { buildSkillRoutingSection, normalizeSkillActivation } from "./skill-routing"

describe("skill routing", () => {
  it("provides an auto-routing catalog without injecting skill bodies", () => {
    const root = mkdtempSync(join(tmpdir(), "ozc-skill-routing-"))
    const dir = join(root, "demo")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "SKILL.md"), "---\nname: demo\ndescription: Demo workflow\n---\nAUTO SKILL BODY\n")

    const section = buildSkillRoutingSection({ mode: "auto" }, [root])
    assert.match(section ?? "", /# Automatic Skill Routing/)
    assert.match(section ?? "", /\*\*demo\*\* — Demo workflow/)
    assert.match(section ?? "", /Instructions: .*SKILL\.md/)
    assert.doesNotMatch(section ?? "", /AUTO SKILL BODY/)
  })

  it("normalizes legacy manual settings to disabled routing", () => {
    assert.deepEqual(normalizeSkillActivation({ mode: "manual", names: ["demo", "demo", 3] }), { mode: "off" })
    assert.deepEqual(normalizeSkillActivation({ mode: "auto", names: ["demo"] }), { mode: "auto" })
    assert.deepEqual(normalizeSkillActivation(null), { mode: "off" })
  })
})
