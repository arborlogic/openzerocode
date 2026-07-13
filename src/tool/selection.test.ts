import { describe, it } from "node:test"
import assert from "node:assert"
import { Schema } from "effect"
import { Def } from "./types"
import { selectEnabledTools, selectPlanModeTools, listSelectableGroups, toggleGroup, isSelectable } from "./selection"

const mk = (id: string, group?: string) =>
  new Def({
    id,
    description: id,
    parameters: Schema.Struct({}),
    execute: () => { throw new Error("not called") },
    group,
  })

const tools = [
  mk("read"),
  mk("bash"),
  mk("browser_navigate", "browser"),
  mk("browser_read", "browser"),
  mk("call_peer", "peer"),
]

describe("tool selection", () => {
  it("treats only grouped tools as selectable", () => {
    assert.equal(isSelectable(mk("read")), false)
    assert.equal(isSelectable(mk("browser_read", "browser")), true)
  })

  it("keeps all tools when nothing is disabled", () => {
    assert.equal(selectEnabledTools(tools, []).length, tools.length)
  })

  it("drops every tool in a disabled group but keeps core tools", () => {
    const enabled = selectEnabledTools(tools, ["browser"])
    const ids = enabled.map((t) => t.id)
    assert.deepEqual(ids, ["read", "bash", "call_peer"])
  })

  it("can disable multiple groups at once", () => {
    const enabled = selectEnabledTools(tools, ["browser", "peer"])
    assert.deepEqual(enabled.map((t) => t.id), ["read", "bash"])
  })

  it("keeps only read-only inspection tools in plan mode", () => {
    const enabled = selectPlanModeTools([
      mk("read"),
      mk("grep"),
      mk("glob"),
      mk("web_fetch"),
      mk("analyze_image"),
      mk("write"),
      mk("bash"),
      mk("todowrite"),
      mk("browser_read", "browser"),
    ])

    assert.deepEqual(enabled.map((t) => t.id), ["read", "grep", "glob", "web_fetch", "analyze_image"])
  })

  it("lists selectable groups with counts and enabled state", () => {
    const groups = listSelectableGroups(tools, ["peer"])
    const browser = groups.find((g) => g.id === "browser")!
    const peer = groups.find((g) => g.id === "peer")!
    assert.equal(browser.count, 2)
    assert.equal(browser.enabled, true)
    assert.equal(browser.label, "Browser (GEASS)")
    assert.equal(peer.enabled, false)
  })

  it("does not list core (ungrouped) tools as groups", () => {
    const groups = listSelectableGroups(tools, [])
    assert.deepEqual(groups.map((g) => g.id).sort(), ["browser", "peer"])
  })

  it("toggles a group in and out of the denylist", () => {
    assert.deepEqual(toggleGroup([], "browser"), ["browser"])
    assert.deepEqual(toggleGroup(["browser"], "browser"), [])
  })
})
