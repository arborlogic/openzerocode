import { describe, it } from "node:test"
import assert from "node:assert"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { autoDetectProvider, defaultModelForProvider, PROVIDERS, resolveProviderApiKey } from "./registry"

describe("provider registry", () => {
  it("includes openai", () => {
    const def = PROVIDERS.openai
    assert.ok(def)
    assert.equal(def.id, "openai")
    assert.equal(def.name, "OpenAI")
    assert.equal(def.defaultModel, "gpt-5.4")
    assert.deepEqual(def.envKeys, ["OPENAI_API_KEY"])
  })

  it("includes openai codex", () => {
    const def = PROVIDERS["openai-codex"]
    assert.ok(def)
    assert.equal(def.id, "openai-codex")
    assert.equal(def.name, "OpenAI Codex")
    assert.equal(def.defaultModel, "gpt-5.6-sol")
    assert.equal(def.authOptional, true)
  })

  it("includes xai oauth", () => {
    const def = PROVIDERS["xai-oauth"]
    assert.ok(def)
    assert.equal(def.id, "xai-oauth")
    assert.equal(def.name, "xAI Grok OAuth")
    assert.equal(def.defaultModel, "grok-build-0.1")
    assert.equal(def.authOptional, true)
  })

  it("includes openrouter", () => {
    const def = PROVIDERS.openrouter
    assert.ok(def)
    assert.equal(def.id, "openrouter")
    assert.equal(def.name, "OpenRouter")
    assert.equal(def.defaultModel, "openrouter/auto")
    assert.equal(def.authOptional, undefined)
  })

  it("resolves provider keys from env and auto-detects them", () => {
    const previous = {
      openai: process.env.OPENAI_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
      opencode: process.env.OPENCODE_API,
      opencodeKey: process.env.OPENCODE_API_KEY,
      providerConfig: process.env.OPENZEROCODE_PROVIDER_CONFIG,
    }
    const tempDir = mkdtempSync(join(tmpdir(), "openzerocode-registry-"))
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENCODE_API
    delete process.env.OPENCODE_API_KEY
    process.env.OPENZEROCODE_PROVIDER_CONFIG = join(tempDir, "providers.json")
    process.env.OPENAI_API_KEY = "sk-test-openai"
    try {
      assert.equal(resolveProviderApiKey("openai"), "sk-test-openai")
      assert.equal(autoDetectProvider(), "openai")
      assert.equal(defaultModelForProvider("openai"), "gpt-5.4")
    } finally {
      if (previous.openai === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = previous.openai
      if (previous.openrouter === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = previous.openrouter
      if (previous.opencode === undefined) delete process.env.OPENCODE_API
      else process.env.OPENCODE_API = previous.opencode
      if (previous.opencodeKey === undefined) delete process.env.OPENCODE_API_KEY
      else process.env.OPENCODE_API_KEY = previous.opencodeKey
      if (previous.providerConfig === undefined) delete process.env.OPENZEROCODE_PROVIDER_CONFIG
      else process.env.OPENZEROCODE_PROVIDER_CONFIG = previous.providerConfig
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
