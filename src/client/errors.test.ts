import { describe, it } from "node:test"
import assert from "node:assert"
import { formatProviderError, isRateLimitError, delay } from "./errors"

describe("formatProviderError", () => {
  it("formats rate limit errors (429)", () => {
    const err = new Error("HTTP 429 Too Many Requests")
    const msg = formatProviderError(err)
    assert.ok(msg.includes("rate limit"))
    assert.ok(!msg.includes("Provider error:"))
  })

  it("formats rate limit errors (FreeUsageLimitError)", () => {
    const err = new Error("FreeUsageLimitError: limit reached")
    const msg = formatProviderError(err)
    assert.ok(msg.includes("rate limit"))
  })

  it("formats auth errors (401)", () => {
    const err = new Error("401 Invalid API key")
    const msg = formatProviderError(err)
    assert.ok(msg.includes("authentication failed"))
  })

  it("formats auth errors (AuthError)", () => {
    const err = new Error("AuthError: invalid credentials")
    const msg = formatProviderError(err)
    assert.ok(msg.includes("authentication failed"))
  })

  it("formats network errors", () => {
    const err = new Error("fetch failed: connect ENETUNREACH")
    const msg = formatProviderError(err)
    assert.ok(msg.includes("Network error"))
  })

  it("formats SSL errors", () => {
    const err = new Error("SSL: CERTIFICATE_VERIFY_FAILED")
    const msg = formatProviderError(err)
    assert.ok(msg.includes("Network error"))
  })

  it("formats generic errors", () => {
    const err = new Error("Something unexpected happened")
    const msg = formatProviderError(err)
    assert.equal(msg, "Provider error: Something unexpected happened")
  })

  it("handles non-Error input", () => {
    const msg = formatProviderError("string error")
    assert.equal(msg, "Provider error: string error")
  })

  it("handles null input", () => {
    const msg = formatProviderError(null)
    assert.equal(msg, "Provider error: null")
  })

  it("handles object input", () => {
    const msg = formatProviderError({ code: 500 })
    assert.equal(msg, "Provider error: [object Object]")
  })
})

describe("isRateLimitError", () => {
  it("detects 429 errors", () => {
    assert.ok(isRateLimitError(new Error("429 Too Many Requests")))
  })

  it("detects FreeUsageLimitError", () => {
    assert.ok(isRateLimitError(new Error("FreeUsageLimitError")))
  })

  it("detects common rate limit messages", () => {
    assert.ok(isRateLimitError(new Error("Rate limit exceeded")))
  })

  it("returns false for non-rate-limit errors", () => {
    assert.ok(!isRateLimitError(new Error("Auth error")))
  })

  it("converts non-Error input via String() and matches '429'", () => {
    // isRateLimitError converts non-Error via String(), so "429" still matches
    assert.ok(isRateLimitError("429"))
  })

  it("returns false for non-Error input without rate-limit keywords", () => {
    assert.ok(!isRateLimitError("random error"))
  })
})

describe("delay", () => {
  it("resolves after the given time", async () => {
    const start = Date.now()
    await delay(10)
    const elapsed = Date.now() - start
    assert.ok(elapsed >= 5)
  })
})
