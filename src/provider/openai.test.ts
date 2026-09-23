import { describe, it } from "node:test"
import assert from "node:assert"
import { Effect } from "effect"
import { Provider } from "./types"
import { def } from "./openai"

describe("openai provider request serialization", () => {
  it("forwards reasoning effort for GPT-6 Astra", async () => {
    const originalFetch = globalThis.fetch
    let requestBody: any
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({
        id: "chatcmpl_test",
        model: "gpt-6-astra",
        choices: [{ message: { role: "assistant", content: "seen" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    }) as typeof fetch

    try {
      const providerLayer = def.factory({ apiKey: "test", model: "gpt-6-astra" })
      await Effect.runPromise(Effect.gen(function* () {
        const provider = yield* Provider
        return yield* provider.complete({
          model: "gpt-6-astra",
          messages: [{ role: "user", content: "solve this" }],
          stream: false,
          reasoning_effort: "max",
        })
      }).pipe(Effect.provide(providerLayer)))
    } finally {
      globalThis.fetch = originalFetch
    }

    assert.equal(requestBody.model, "gpt-6-astra")
    assert.equal(requestBody.reasoning_effort, "max")
  })
})
