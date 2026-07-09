import { describe, it } from "node:test"
import assert from "node:assert"
import { SIDEBAR_WIDTH, sidebarWidthForTerminal } from "./tui-constants"

describe("sidebarWidthForTerminal", () => {
  it("keeps the original sidebar width on normal and wide terminals", () => {
    assert.equal(sidebarWidthForTerminal(120), SIDEBAR_WIDTH)
    assert.equal(sidebarWidthForTerminal(170), SIDEBAR_WIDTH)
    assert.equal(sidebarWidthForTerminal(240), SIDEBAR_WIDTH)
  })

  it("shrinks only when the terminal is too narrow for the overlay", () => {
    assert.equal(sidebarWidthForTerminal(26), 24)
    assert.equal(sidebarWidthForTerminal(32), 28)
  })
})
