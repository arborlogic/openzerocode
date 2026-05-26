import { describe, it } from "node:test"
import assert from "node:assert"
import { addPermissionRules, isSafePermission, shouldAutoApprove } from "./permission-rules"

describe("isSafePermission", () => {
  it("allows read-style tools without prompting", () => {
    assert.equal(isSafePermission("read"), true)
    assert.equal(isSafePermission("grep"), true)
    assert.equal(isSafePermission("glob"), true)
    assert.equal(isSafePermission("web_fetch"), true)
    assert.equal(isSafePermission("edit"), false)
  })
})

describe("shouldAutoApprove", () => {
  it("auto-approves safe permissions", () => {
    assert.equal(shouldAutoApprove({ permission: "read", patterns: ["README.md"] }, []), true)
  })

  it("auto-approves exact allowed patterns", () => {
    assert.equal(
      shouldAutoApprove(
        { permission: "edit", patterns: ["src/client/tui.tsx"] },
        [{ permission: "edit", pattern: "src/client/tui.tsx", action: "allow" }],
      ),
      true,
    )
  })

  it("requires all request patterns to be allowed", () => {
    assert.equal(
      shouldAutoApprove(
        { permission: "bash", patterns: ["npm run typecheck", "npm run dev"] },
        [{ permission: "bash", pattern: "npm run typecheck", action: "allow" }],
      ),
      false,
    )
  })
})

describe("addPermissionRules", () => {
  it("adds new allow rules for the request patterns", () => {
    const rules = addPermissionRules([], {
      permission: "bash",
      patterns: ["npm run typecheck", "npm run build"],
    })

    assert.deepEqual(rules, [
      { permission: "bash", pattern: "npm run typecheck", action: "allow" },
      { permission: "bash", pattern: "npm run build", action: "allow" },
    ])
  })

  it("does not duplicate existing allow rules", () => {
    const rules = addPermissionRules(
      [{ permission: "edit", pattern: "src/client/tui.tsx", action: "allow" }],
      { permission: "edit", patterns: ["src/client/tui.tsx"] },
    )

    assert.equal(rules.length, 1)
  })
})
