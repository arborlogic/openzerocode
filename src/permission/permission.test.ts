import { describe, it } from "node:test"
import assert from "node:assert"
import { matchPattern, evaluate, check } from "./index"
import type { Rule } from "./index"

describe("matchPattern", () => {
  it("matches exact strings", () => {
    assert.ok(matchPattern("read", "read"))
  })

  it("rejects different strings", () => {
    assert.ok(!matchPattern("read", "write"))
  })

  it("wildcard '*' matches anything", () => {
    assert.ok(matchPattern("*", "anything"))
    assert.ok(matchPattern("*", ""))
    assert.ok(matchPattern("*", "a/b/c"))
  })

  it("glob '*' matches within string", () => {
    assert.ok(matchPattern("src/*", "src/index.ts"))
    assert.ok(matchPattern("*.ts", "index.ts"))
    assert.ok(!matchPattern("*.ts", "index.js"))
  })

  it("glob '**' matches multiple segments", () => {
    assert.ok(matchPattern("src/**/*.ts", "src/client/tui.ts"))
    assert.ok(matchPattern("src/**/*.ts", "src/deep/path/file.ts"))
  })

  it("anchors the pattern to start and end", () => {
    // regex is ^pattern$ so it must match the whole string
    assert.ok(!matchPattern("read", "readme"))
    assert.ok(!matchPattern("read", "bread"))
  })
})

describe("evaluate", () => {
  const rule: Rule = { permission: "edit", pattern: "src/*.ts", action: "allow" }

  it("returns action when permission and pattern match", () => {
    const result = evaluate(rule, "edit", ["src/main.ts"])
    assert.equal(result, "allow")
  })

  it("returns null when permission does not match", () => {
    const result = evaluate(rule, "bash", ["src/main.ts"])
    assert.equal(result, null)
  })

  it("returns null when no pattern matches", () => {
    const result = evaluate(rule, "edit", ["README.md"])
    assert.equal(result, null)
  })

  it("returns action when any pattern matches (first match wins)", () => {
    const result = evaluate(rule, "edit", ["README.md", "src/main.ts"])
    assert.equal(result, "allow")
  })

  it("supports deny actions", () => {
    const denyRule: Rule = { permission: "*", pattern: "secrets/*", action: "deny" }
    const result = evaluate(denyRule, "read", ["secrets/keys.txt"])
    assert.equal(result, "deny")
  })

  it("matches with glob permission pattern", () => {
    const rule2: Rule = { permission: "tool-*", pattern: "*", action: "allow" }
    assert.equal(evaluate(rule2, "tool-read", ["anything"]), "allow")
    assert.equal(evaluate(rule2, "tool-write", ["anything"]), "allow")
    assert.equal(evaluate(rule2, "bash", ["anything"]), null)
  })
})

describe("check", () => {
  const rules: Rule[] = [
    { permission: "read", pattern: "*", action: "allow" },
    { permission: "edit", pattern: "src/*.ts", action: "allow" },
    { permission: "*", pattern: ".env*", action: "deny" },
  ]

  it("returns allow for matching allow rule", () => {
    assert.equal(check(rules, "read", ["README.md"]), "allow")
  })

  it("returns deny when deny rule appears before allow", () => {
    // Put deny first to test that first-match-wins picks deny
    const denyFirst: Rule[] = [
      { permission: "*", pattern: ".env*", action: "deny" },
      { permission: "read", pattern: "*", action: "allow" },
    ]
    assert.equal(check(denyFirst, "read", [".env"]), "deny")
  })

  it("returns ask when no rule matches", () => {
    assert.equal(check(rules, "bash", ["npm run test"]), "ask")
  })

  it("respects rule order (first match wins)", () => {
    // read is allow, * is deny, but read comes first
    const orderedRules: Rule[] = [
      { permission: "read", pattern: ".env*", action: "allow" },
      { permission: "*", pattern: ".env*", action: "deny" },
    ]
    assert.equal(check(orderedRules, "read", [".env"]), "allow")
  })

  it("returns ask for empty rules", () => {
    assert.equal(check([], "read", ["file.txt"]), "ask")
  })
})
