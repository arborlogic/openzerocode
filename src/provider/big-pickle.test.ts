import { afterEach, describe, it } from "node:test"
import assert from "node:assert"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { filterBigPickleModels, isAnonymousBigPickleModel, normalizeBigPickleModel } from "./big-pickle"

const ORIG_PROVIDER_CONFIG = process.env.OPENZEROCODE_PROVIDER_CONFIG
let tempDir = ""

function isolateProviderConfig() {
  tempDir = mkdtempSync(join(tmpdir(), "ozc-big-pickle-test-"))
  process.env.OPENZEROCODE_PROVIDER_CONFIG = join(tempDir, "providers.json")
}

describe("opencode-zen anonymous model filtering", () => {
  afterEach(() => {
    if (ORIG_PROVIDER_CONFIG === undefined) delete process.env.OPENZEROCODE_PROVIDER_CONFIG
    else process.env.OPENZEROCODE_PROVIDER_CONFIG = ORIG_PROVIDER_CONFIG
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
      tempDir = ""
    }
  })

  it("treats big-pickle and API-provided -free model ids as anonymous models", () => {
    assert.equal(isAnonymousBigPickleModel("big-pickle"), true)
    assert.equal(isAnonymousBigPickleModel("new-runtime-model-free"), true)
    assert.equal(isAnonymousBigPickleModel("new-runtime-model"), false)
  })

  it("derives anonymous/free models from returned model ids", () => {
    isolateProviderConfig()

    assert.deepEqual(
      filterBigPickleModels([
        "big-pickle",
        "deepseek-v4-flash-free",
        "brand-new-model-free",
        "paid-model",
      ]),
      ["big-pickle", "deepseek-v4-flash-free", "brand-new-model-free"],
    )
  })

  it("normalizes paid models to big-pickle when no key is configured", () => {
    isolateProviderConfig()

    assert.equal(normalizeBigPickleModel("brand-new-model-free"), "brand-new-model-free")
    assert.equal(normalizeBigPickleModel("paid-model"), "big-pickle")
  })
})
