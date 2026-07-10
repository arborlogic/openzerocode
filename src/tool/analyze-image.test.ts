import { afterEach, describe, it } from "node:test"
import assert from "node:assert"
import { mkdtempSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { Effect } from "effect"
import { Context } from "./types"
import { AnalyzeImageTool } from "./analyze-image"

// Tiny 1x1 PNG
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

const originalFetch = globalThis.fetch

function testCtx(model?: string): Context {
  return new Context({
    abort: new AbortController().signal,
    cwd: process.cwd(),
    root: process.cwd(),
    model,
    ask: () => Effect.void,
    metadata: () => Effect.void,
  })
}

function tempPng(name = "shot.png"): string {
  const dir = mkdtempSync(join(tmpdir(), "ozc-analyze-image-"))
  const path = join(dir, name)
  writeFileSync(path, PNG_1X1)
  return path
}

function stubFetch(handler: (url: string) => Response | Promise<Response>): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    return handler(url)
  }) as typeof fetch
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("analyze_image", () => {
  it("prefers native vision attachment when chat model supports vision", async () => {
    let fetchCalls = 0
    stubFetch(async () => {
      fetchCalls += 1
      throw new Error("local VLM should not be called for vision models")
    })

    const path = tempPng()
    const tool = await Effect.runPromise(AnalyzeImageTool)
    const result = await Effect.runPromise(tool.execute({ path }, testCtx("gpt-5.5")))

    assert.equal(result.metadata?.analysisPath, "native")
    assert.ok(result.output.includes("native model vision"))
    assert.equal(result.images?.length, 1)
    assert.equal(result.images?.[0]?.mimeType, "image/png")
    assert.equal(result.images?.[0]?.base64, PNG_1X1.toString("base64"))
    assert.equal(fetchCalls, 0)
  })

  it("uses local VLM when chat model does not support vision", async () => {
    let fetchCalls = 0
    stubFetch(async (url) => {
      fetchCalls += 1
      assert.ok(url.includes("/v1/chat/completions"))
      return new Response(JSON.stringify({
        choices: [{ message: { content: "a red pixel" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    })

    const path = tempPng()
    const tool = await Effect.runPromise(AnalyzeImageTool)
    const result = await Effect.runPromise(tool.execute({ path }, testCtx("some-text-model")))

    assert.equal(result.metadata?.analysisPath, "local_vlm")
    assert.ok(result.output.includes("a red pixel"))
    assert.equal(result.images?.length, 1)
    assert.ok(fetchCalls >= 1)
  })

  it("forces local VLM when endpoint override is provided even on vision models", async () => {
    let seenUrl = ""
    stubFetch(async (url) => {
      seenUrl = url
      return new Response(JSON.stringify({
        choices: [{ message: { content: "forced local" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    })

    const path = tempPng()
    const tool = await Effect.runPromise(AnalyzeImageTool)
    const result = await Effect.runPromise(tool.execute({
      path,
      endpoint: "http://forced-vlm.example",
    }, testCtx("gpt-5.5")))

    assert.equal(result.metadata?.analysisPath, "local_vlm")
    assert.ok(result.output.includes("forced local"))
    assert.ok(seenUrl.startsWith("http://forced-vlm.example/"))
  })

  it("returns file error for missing path without calling VLM", async () => {
    let fetchCalls = 0
    stubFetch(async () => {
      fetchCalls += 1
      throw new Error("should not fetch")
    })

    const tool = await Effect.runPromise(AnalyzeImageTool)
    const result = await Effect.runPromise(tool.execute({ path: "/no/such/image.png" }, testCtx("gpt-5.5")))
    assert.equal(result.title, "File Error")
    assert.equal(result.images, undefined)
    assert.equal(fetchCalls, 0)
  })
})
