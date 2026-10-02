/**
 * Intentionally stale client used by the public hackathon demo.
 * The task is to research Tavily's current Search API and repair this code.
 */
export async function searchWeb(query, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const apiKey = options.apiKey ?? process.env.TAVILY_API_KEY
  if (!apiKey) throw new Error("TAVILY_API_KEY is required")

  const response = await fetchImpl("https://api.tavily.com/v1/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      q: query,
      depth: "advanced",
      limit: 3,
    }),
  })

  if (!response.ok) throw new Error(`Search failed: ${response.status}`)
  return response.json()
}
