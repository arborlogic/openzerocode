import test from "node:test"
import assert from "node:assert/strict"
import { searchWeb } from "../src/tavily-client.mjs"

test("uses the current Tavily Search API request shape", async () => {
  let captured
  const fetchImpl = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) }
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }

  await searchWeb("OpenZeroCode", { fetchImpl, apiKey: "demo-key" })

  assert.equal(captured.url, "https://api.tavily.com/search")
  assert.equal(new Headers(captured.init.headers).get("Authorization"), "Bearer demo-key")
  assert.equal(captured.body.query, "OpenZeroCode")
  assert.equal(captured.body.search_depth, "advanced")
  assert.equal(captured.body.max_results, 3)
  assert.equal("q" in captured.body, false)
  assert.equal("depth" in captured.body, false)
  assert.equal("limit" in captured.body, false)
})
