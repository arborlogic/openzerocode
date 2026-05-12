export function formatProviderError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (text.includes("429") || text.includes("Rate limit exceeded") || text.includes("FreeUsageLimitError")) {
    return "Provider rate limit reached (free tier). Please wait a bit and try again, or switch to another provider/model."
  }
  if (text.includes("401") || text.includes("AuthError") || text.includes("Invalid API key")) {
    return "Provider authentication failed. Check OPENCODE_API."
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

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
