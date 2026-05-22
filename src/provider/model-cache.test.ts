import { beforeEach, afterEach, describe, it } from "node:test"
import assert from "node:assert"
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { getCachedModelInfo, getCachedModels, readModelCache, setCachedModels } from "./model-cache"

const ORIG_HOME = process.env.HOME
let tempHome = ""

describe("model-cache", () => {
  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "ozc-model-cache-test-"))
    process.env.HOME = tempHome
  })

  afterEach(() => {
    process.env.HOME = ORIG_HOME
    if (tempHome) {
      rmSync(tempHome, { recursive: true, force: true })
      tempHome = ""
    }
  })

  it("persists provider model metadata under ~/.openzerocode/model-cache.json", () => {
    const saved = setCachedModels("openrouter", [
      { id: "zeta", contextLimit: 200_000, pricing: { input: 1, output: 2 } },
      { id: "alpha", contextLimit: 100_000 },
      { id: "zeta", contextLimit: 200_000, pricing: { input: 1, output: 2 } },
    ])

    assert.deepEqual(saved.map((model) => model.id), ["alpha", "zeta"])

    const file = join(tempHome, ".openzerocode", "model-cache.json")
    assert.ok(existsSync(file))

    const raw = JSON.parse(readFileSync(file, "utf-8"))
    assert.equal(raw.openrouter.models.length, 2)
    assert.equal(getCachedModels("openrouter").length, 2)
    assert.deepEqual(getCachedModelInfo("openrouter", "zeta"), {
      id: "zeta",
      contextLimit: 200_000,
      pricing: { input: 1, output: 2 },
    })
  })

  it("ignores invalid cache content and returns an empty cache", () => {
    const dir = join(tempHome, ".openzerocode")
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "model-cache.json"), JSON.stringify({ openai: { models: [{ nope: true }] } }))

    assert.deepEqual(readModelCache(), {})
  })
})
