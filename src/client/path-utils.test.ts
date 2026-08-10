import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { displayPath } from "./path-utils"

describe("displayPath", () => {
  it("shortens paths inside the configured home directory", () => {
    const previousHome = process.env.HOME
    process.env.HOME = "/Users/masato"

    try {
      assert.equal(displayPath("/Users/masato/Dev/ai-util/openzerocode"), "~/Dev/ai-util/openzerocode")
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
    }
  })
})
