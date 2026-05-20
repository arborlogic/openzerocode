import { describe, it } from "node:test"
import assert from "node:assert"
import { extractFilter, filterCommands, shouldShowAutocomplete, clampIndex } from "./autocomplete-logic"
import { BUILTIN_COMMANDS } from "./commands"

const noop = () => {}

describe("extractFilter", () => {
  it("returns empty string for text without /", () => {
    assert.equal(extractFilter("hello"), "")
  })

  it("returns the filter after /", () => {
    assert.equal(extractFilter("/help"), "help")
  })

  it("stops at first space", () => {
    assert.equal(extractFilter("/model big-pickle"), "model")
  })

  it("returns empty string for just /", () => {
    assert.equal(extractFilter("/"), "")
  })

  it("returns empty string for empty string", () => {
    assert.equal(extractFilter(""), "")
  })
})

describe("shouldShowAutocomplete", () => {
  it("returns true for / prefix without space", () => {
    assert.equal(shouldShowAutocomplete("/"), true)
    assert.equal(shouldShowAutocomplete("/help"), true)
    assert.equal(shouldShowAutocomplete("/model"), true)
  })

  it("returns false for text without /", () => {
    assert.equal(shouldShowAutocomplete("hello"), false)
    assert.equal(shouldShowAutocomplete(""), false)
  })

  it("returns false when space is present", () => {
    assert.equal(shouldShowAutocomplete("/model "), false)
    assert.equal(shouldShowAutocomplete("/help me"), false)
  })
})

describe("filterCommands", () => {
  it("returns all commands when filter is empty", () => {
    const items = filterCommands(BUILTIN_COMMANDS, "", noop)
    assert.ok(items.length >= 6)
    assert.ok(items.some((i) => i.display === "/help"))
    assert.ok(items.some((i) => i.display === "/exit"))
  })

  it("filters commands by prefix", () => {
    const items = filterCommands(BUILTIN_COMMANDS, "mo", noop)
    assert.equal(items.length, 2)
    assert.ok(items.some((i) => i.display === "/model"))
    assert.ok(items.some((i) => i.display === "/mode"))
  })

  it("matches against aliases", () => {
    const items = filterCommands(BUILTIN_COMMANDS, "q", noop)
    assert.ok(items.some((i) => i.display === "/quit"))
  })

  it("returns empty when no commands match", () => {
    const items = filterCommands(BUILTIN_COMMANDS, "zzz", noop)
    assert.equal(items.length, 0)
  })

  it("includes description in items", () => {
    const items = filterCommands(BUILTIN_COMMANDS, "help", noop)
    assert.equal(items.length, 1)
    assert.equal(items[0]!.description, "Show help, shortcuts and palette guide")
  })

  it("includes /compact in matching commands", () => {
    const items = filterCommands(BUILTIN_COMMANDS, "comp", noop)
    assert.ok(items.some((i) => i.display === "/compact"))
  })

  it("calls onSelect with command name and empty args", () => {
    const calls: string[] = []
    const items = filterCommands(BUILTIN_COMMANDS, "help", (name) => calls.push(name))
    items[0]!.onSelect()
    assert.deepEqual(calls, ["help"])
  })
})

describe("clampIndex", () => {
  it("wraps forward past the end", () => {
    assert.equal(clampIndex(5, 1, 6), 0)
  })

  it("wraps backward past the start", () => {
    assert.equal(clampIndex(0, -1, 6), 5)
  })

  it("moves forward within bounds", () => {
    assert.equal(clampIndex(2, 1, 6), 3)
  })

  it("moves backward within bounds", () => {
    assert.equal(clampIndex(2, -1, 6), 1)
  })

  it("returns prev when length is 0", () => {
    assert.equal(clampIndex(0, 1, 0), 0)
  })
})
