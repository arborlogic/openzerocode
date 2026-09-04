import { afterEach, describe, it } from "node:test"
import assert from "node:assert"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { Effect } from "effect"
import { layer, filterBigPickleModels, isAnonymousBigPickleModel, normalizeBigPickleModel } from "./big-pickle"
import { Provider } from "./types"

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

  it("forwards session-affinity headers without serializing them into Zen requests", async () => {
    const originalFetch = globalThis.fetch
    let init: RequestInit | undefined
    globalThis.fetch = (async (_input, requestInit) => {
      init = requestInit
      return new Response(JSON.stringify({
        id: "completion_1",
        model: "big-pickle",
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200 })
    }) as typeof fetch

    try {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const provider = yield* Provider
          return yield* provider.complete({
            model: "big-pickle",
            messages: [{ role: "user", content: "hello" }],
            stream: false,
            requestHeaders: {
              "x-opencode-session": "session_1",
              "x-opencode-request": "request_1",
              "x-opencode-client": "openzerocode",
            },
          })
        }).pipe(Effect.provide(layer({ apiKey: "test-key", baseURL: "https://zen.test/v1" }))),
      )

      assert.equal(result.message.content, "ok")
      assert.deepEqual(init?.headers, {
        "Content-Type": "application/json",
        Authorization: "Bearer test-key",
        "x-opencode-session": "session_1",
        "x-opencode-request": "request_1",
        "x-opencode-client": "openzerocode",
      })
      assert.doesNotMatch(String(init?.body), /requestHeaders/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
