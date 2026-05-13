import { afterEach, beforeEach, describe, it } from "node:test"
import assert from "node:assert"
import { mkdtempSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  getActiveConfiguredProviderKeyName,
  getProviderConfigPath,
  listConfiguredProviderKeys,
  readProviderConfig,
  resolveConfiguredProviderApiKey,
  setActiveConfiguredProviderKey,
} from "./config"

let tempDir = ""
let tempFile = ""
let previousEnv = ""

describe("provider config", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openzerocode-provider-config-"))
    tempFile = join(tempDir, "providers.json")
    previousEnv = process.env.OPENZEROCODE_PROVIDER_CONFIG ?? ""
    process.env.OPENZEROCODE_PROVIDER_CONFIG = tempFile
  })

  afterEach(() => {
    if (previousEnv) process.env.OPENZEROCODE_PROVIDER_CONFIG = previousEnv
    else delete process.env.OPENZEROCODE_PROVIDER_CONFIG
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  })

  it("uses the configured path override", () => {
    assert.equal(getProviderConfigPath(), tempFile)
  })

  it("reads configured provider keys and active key", () => {
    writeFileSync(tempFile, JSON.stringify({
      providers: {
        openrouter: {
          activeKey: "work",
          keys: {
            work: "sk-work",
            personal: "sk-personal",
          },
        },
      },
    }), "utf-8")

    assert.deepEqual(readProviderConfig().providers?.openrouter?.keys, {
      work: "sk-work",
      personal: "sk-personal",
    })
    assert.deepEqual(listConfiguredProviderKeys("openrouter"), ["personal", "work"])
    assert.equal(getActiveConfiguredProviderKeyName("openrouter"), "work")
    assert.equal(resolveConfiguredProviderApiKey("openrouter"), "sk-work")
  })

  it("switches the active configured key", () => {
    writeFileSync(tempFile, JSON.stringify({
      providers: {
        openrouter: {
          activeKey: "work",
          keys: {
            work: "sk-work",
            personal: "sk-personal",
          },
        },
      },
    }), "utf-8")

    const result = setActiveConfiguredProviderKey("openrouter", "personal")
    assert.equal(result.ok, true)
    assert.equal(getActiveConfiguredProviderKeyName("openrouter"), "personal")
    assert.equal(resolveConfiguredProviderApiKey("openrouter"), "sk-personal")
  })
})
