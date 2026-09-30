import { describe, it } from "node:test"
import assert from "node:assert"
import { SIDEBAR_WIDTH, idleFooterStatus, sidebarWidthForTerminal } from "./tui-constants"

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

describe("idleFooterStatus", () => {
  it("hides routine idle labels and keeps queued messages visible", () => {
    assert.equal(idleFooterStatus("waiting for input", 0), "")
    assert.equal(idleFooterStatus("autopilot enabled", 0), "")
    assert.equal(idleFooterStatus("waiting for input", 2), "2 queued")
  })

  it("preserves useful status messages without repeating queue counts", () => {
    assert.equal(idleFooterStatus("session compacted", 0), "session compacted")
    assert.equal(idleFooterStatus("queued • 2 queued", 2), "queued • 2 queued")
    assert.equal(idleFooterStatus("interrupted", 2), "interrupted  •  2 queued")
  })
})
