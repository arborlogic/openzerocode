import { describe, it } from "node:test"
import assert from "node:assert"
import { PROVIDERS } from "./registry"

describe("provider registry", () => {
  it("includes openrouter", () => {
    const def = PROVIDERS.openrouter
    assert.ok(def)
    assert.equal(def.id, "openrouter")
    assert.equal(def.name, "OpenRouter")
    assert.equal(def.defaultModel, "openrouter/auto")
    assert.equal(def.authOptional, undefined)
  })
})
