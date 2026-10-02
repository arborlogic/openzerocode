import { afterEach, describe, it } from "node:test"
import assert from "node:assert"
import { Effect } from "effect"
import { Context } from "./types"
import { WebExtractTool, WebSearchDeepTool, WebSearchTool, isTavilyConfigured } from "./tavily"

const originalFetch = globalThis.fetch
const originalKey = process.env.TAVILY_API_KEY

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.TAVILY_API_KEY
  else process.env.TAVILY_API_KEY = originalKey
})

function testCtx(): Context {
  return new Context({
    abort: new AbortController().signal,
    cwd: process.cwd(),
    root: process.cwd(),
    ask: () => Effect.void,
    metadata: () => Effect.void,
  })
}

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const payload = handler(String(input), init)
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch
}

describe("Tavily research tools", () => {
  it("is unavailable until an API key is configured", () => {
    delete process.env.TAVILY_API_KEY
    assert.equal(isTavilyConfigured(), false)
    process.env.TAVILY_API_KEY = "test-key"
    assert.equal(isTavilyConfigured(), true)
  })

  it("web_search sends a basic Tavily query and returns evidence", async () => {
    process.env.TAVILY_API_KEY = "test-key"
    let body: Record<string, unknown> | undefined
    mockFetch((url, init) => {
      assert.equal(url, "https://api.tavily.com/search")
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-key")
      body = JSON.parse(String(init?.body))
      return {
        request_id: "req-basic",
        usage: { credits: 1 },
        results: [{ title: "Current docs", url: "https://example.com/docs", content: "Latest API behavior", score: 0.9 }],
      }
    })

    const tool = await Effect.runPromise(WebSearchTool)
    const result = await Effect.runPromise(tool.execute({ query: "current API", topic: "general", maxResults: 99 }, testCtx()))

    assert.equal(body?.search_depth, "basic")
    assert.equal(body?.max_results, 10)
    assert.equal(body?.include_answer, false)
    assert.equal(body?.include_raw_content, false)
    assert.ok(result.output.includes("Current docs"))
    assert.ok(result.output.includes("https://example.com/docs"))
    assert.equal(result.metadata?.credits, 1)
    assert.equal(result.metadata?.requestId, "req-basic")
  })

  it("web_search_deep uses advanced depth", async () => {
    process.env.TAVILY_API_KEY = "test-key"
    let depth: unknown
    mockFetch((_url, init) => {
      depth = (JSON.parse(String(init?.body)) as Record<string, unknown>).search_depth
      return { results: [] }
    })

    const tool = await Effect.runPromise(WebSearchDeepTool)
    const result = await Effect.runPromise(tool.execute({ query: "compare SDK migrations", topic: "general" }, testCtx()))

    assert.equal(depth, "advanced")
    assert.equal(result.output, "No relevant web results found.")
  })

  it("web_extract preserves source URLs and reports partial failures", async () => {
    process.env.TAVILY_API_KEY = "test-key"
    let body: Record<string, unknown> | undefined
    mockFetch((_url, init) => {
      body = JSON.parse(String(init?.body))
      return {
        request_id: "req-extract",
        usage: { credits: 1 },
        results: [{ url: "https://example.com/a", raw_content: "Migration detail" }],
        failed_results: [{ url: "https://example.com/b", error: "blocked" }],
      }
    })

    const tool = await Effect.runPromise(WebExtractTool)
    const result = await Effect.runPromise(tool.execute({
      urls: ["https://example.com/a", "https://example.com/b"],
      query: "migration",
      depth: "basic",
    }, testCtx()))

    assert.deepEqual(body?.urls, ["https://example.com/a", "https://example.com/b"])
    assert.equal(body?.chunks_per_source, 3)
    assert.equal(body?.extract_depth, "basic")
    assert.ok(result.output.includes("Source: https://example.com/a"))
    assert.ok(result.output.includes("Failed: https://example.com/b"))
    assert.equal(result.metadata?.failedCount, 1)
  })

  it("redacts Tavily-looking tokens from API error messages", async () => {
    process.env.TAVILY_API_KEY = "test-key"
    globalThis.fetch = (async () => new Response("request rejected for tvly-secret-token", { status: 401 })) as unknown as typeof fetch

    const tool = await Effect.runPromise(WebSearchTool)
    await assert.rejects(
      () => Effect.runPromise(tool.execute({ query: "x", topic: "general" }, testCtx())),
      (error: unknown) => {
        const text = String(error)
        assert.ok(text.includes("[redacted]"))
        assert.ok(!text.includes("tvly-secret-token"))
        return true
      },
    )
  })
})
