export function formatProviderError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (text.includes("429") || text.includes("Rate limit exceeded") || text.includes("FreeUsageLimitError")) {
    return "Provider rate limit reached (free tier). Please wait a bit and try again, or switch to another provider/model."
  }
  if (text.includes("401") || text.includes("AuthError") || text.includes("Invalid API key")) {
    return "Provider authentication failed. Check your provider key configuration."
  }
  if (text.includes("fetch failed") || text.includes("SSL") || text.includes("socket")) {
    return "Network error while contacting provider. Please retry."
  }
  return `Provider error: ${text}`
}

export function isRateLimitError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return text.includes("429") || text.includes("Rate limit exceeded") || text.includes("FreeUsageLimitError")
}

/** Whether a provider request can safely be retried before any response data arrives. */
export function isTransientProviderError(error: unknown): boolean {
  const text = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).toLowerCase()
  return [
    "fetch failed",
    "network",
    "socket",
    "connection reset",
    "connection closed",
    "stream ended before completion",
    "econnreset",
    "econnrefused",
    "ehostunreach",
    "enetwork",
    "timeout",
    "timed out",
    "etimedout",
    "408",
    "502",
    "503",
    "504",
    "no response body",
    "unexpected eof",
    "terminated",
  ].some((marker) => text.includes(marker))
}

/**
 * Whether retrying compaction with a smaller transcript can plausibly help.
 * Authentication, billing, rate-limit, and generic provider failures should
 * surface immediately rather than consuming a second request.
 */
export function isCompactionRetryableError(error: unknown): boolean {
  const text = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).toLowerCase()
  return [
    "timeout",
    "timed out",
    "etimedout",
    "aborterror",
    "408 request timeout",
    "504 gateway timeout",
    "overloaded",
    "503 service unavailable",
    "bad gateway",
    "context length",
    "context_length_exceeded",
    "exceed_context_size_error",
    "exceeds the available context",
    "exceeds available context",
    "maximum context",
    "context window",
    "too many tokens",
    "token limit",
    "request exceeds its context budget",
  ].some((marker) => text.includes(marker))
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
