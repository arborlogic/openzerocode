import { describe, it } from "node:test"
import assert from "node:assert"
import { buildPalette, commandItems, completeCommand, shouldSubmitByEnter } from "./palette"

describe("palette helpers", () => {
  it("buildPalette groups and selects", () => {
    const result = buildPalette({ query: "/", selected: 0, recent: [], commands: commandItems })
    assert.ok(result.items.some((x) => x.startsWith("[ Session ]")))
    assert.ok(result.items.some((x) => x.includes("/help")))
    assert.ok(result.selectedDisplay >= 0)
  })

  it("prioritizes recent commands", () => {
    const result = buildPalette({ query: "/", selected: 0, recent: ["/exit"], commands: commandItems })
    assert.equal(result.filtered[0]?.cmd, "/exit")
  })

  it("completeCommand returns only exact single prefix", () => {
    assert.equal(completeCommand("/cl", commandItems), "/clear")
    assert.equal(completeCommand("/", commandItems), undefined)
  })

  it("shouldSubmitByEnter obeys mode", () => {
    assert.equal(shouldSubmitByEnter({ enterMode: "submit", ctrl: false, hasContent: true }), true)
    assert.equal(shouldSubmitByEnter({ enterMode: "submit", ctrl: true, hasContent: true }), false)
    assert.equal(shouldSubmitByEnter({ enterMode: "newline", ctrl: true, hasContent: true }), true)
    assert.equal(shouldSubmitByEnter({ enterMode: "newline", ctrl: false, hasContent: true }), false)
  })
})
