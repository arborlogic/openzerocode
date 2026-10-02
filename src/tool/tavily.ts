import { Effect, Schema } from "effect"
import { Def, Result } from "./types"

const TAVILY_API_URL = "https://api.tavily.com"
const DEFAULT_MAX_RESULTS = 5
const MAX_RESULTS = 10
const MAX_EXTRACT_URLS = 20
const MAX_SOURCE_CHARS = 8_000
const MAX_TOTAL_OUTPUT_CHARS = 32_000

type TavilyUsage = { credits?: number }
type TavilySearchResult = {
  title?: string
  url?: string
  content?: string
  score?: number
}
type TavilySearchResponse = {
  results?: TavilySearchResult[]
  request_id?: string
  usage?: TavilyUsage
}
type TavilyExtractResult = {
  url?: string
  raw_content?: string
}
type TavilyExtractFailure = {
  url?: string
  error?: string
}
type TavilyExtractResponse = {
  results?: TavilyExtractResult[]
  failed_results?: TavilyExtractFailure[]
  request_id?: string
  usage?: TavilyUsage
}

const SearchParameters = Schema.Struct({
  query: Schema.String,
  maxResults: Schema.optional(Schema.Number),
  topic: Schema.Literals(["general", "news", "finance"])
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("general" as const))),
  includeDomains: Schema.optional(Schema.Array(Schema.String)),
  excludeDomains: Schema.optional(Schema.Array(Schema.String)),
})

type SearchArgs = {
  query: string
  maxResults?: number
  topic: "general" | "news" | "finance"
  includeDomains?: string[]
  excludeDomains?: string[]
}

const ExtractParameters = Schema.Struct({
  urls: Schema.Array(Schema.String),
  query: Schema.optional(Schema.String),
  depth: Schema.Literals(["basic", "advanced"])
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("basic" as const))),
})

type ExtractArgs = {
  urls: string[]
  query?: string
  depth: "basic" | "advanced"
}

function apiKey(): string {
  const key = process.env.TAVILY_API_KEY?.trim()
  if (!key) throw new Error("Tavily is not configured. Set TAVILY_API_KEY to enable web research.")
  return key
}

export function isTavilyConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY?.trim())
}

function clampMaxResults(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_MAX_RESULTS
  return Math.max(1, Math.min(MAX_RESULTS, Math.floor(value!)))
}

function truncate(text: string, maxChars: number): string {
  const normalized = text.trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

async function tavilyPost<T>(path: string, body: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${TAVILY_API_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    const safeDetail = truncate(detail.replace(/tvly-[A-Za-z0-9_-]+/g, "[redacted]"), 500)
    throw new Error(`Tavily API ${response.status}: ${safeDetail || response.statusText}`)
  }

  return await response.json() as T
}

function formatSearchResponse(response: TavilySearchResponse): string {
  const results = response.results ?? []
  if (results.length === 0) return "No relevant web results found."

  return results.map((result, index) => {
    const title = result.title?.trim() || "Untitled"
    const url = result.url?.trim() || "(no URL)"
    const content = truncate(result.content ?? "", MAX_SOURCE_CHARS)
    return [`[${index + 1}] ${title}`, url, content].filter(Boolean).join("\n")
  }).join("\n\n")
}

function formatExtractResponse(response: TavilyExtractResponse): string {
  const blocks: string[] = []
  let usedChars = 0

  for (const result of response.results ?? []) {
    if (usedChars >= MAX_TOTAL_OUTPUT_CHARS) break
    const url = result.url?.trim() || "(unknown URL)"
    const remaining = Math.max(0, MAX_TOTAL_OUTPUT_CHARS - usedChars)
    const content = truncate(result.raw_content ?? "", Math.min(MAX_SOURCE_CHARS, remaining))
    const block = [`Source: ${url}`, content].filter(Boolean).join("\n")
    blocks.push(block)
    usedChars += block.length
  }

  for (const failure of response.failed_results ?? []) {
    blocks.push(`Failed: ${failure.url ?? "(unknown URL)"} — ${failure.error ?? "extract failed"}`)
  }

  return blocks.length > 0 ? blocks.join("\n\n") : "No content could be extracted."
}

async function search(args: SearchArgs, depth: "basic" | "advanced", signal: AbortSignal) {
  const maxResults = clampMaxResults(args.maxResults)
  const response = await tavilyPost<TavilySearchResponse>("/search", {
    query: args.query,
    search_depth: depth,
    chunks_per_source: 3,
    max_results: maxResults,
    topic: args.topic,
    include_answer: false,
    include_raw_content: false,
    include_domains: args.includeDomains,
    exclude_domains: args.excludeDomains,
    include_usage: true,
  }, signal)

  return new Result({
    title: depth === "advanced" ? `Deep research: ${args.query}` : `Web research: ${args.query}`,
    output: formatSearchResponse(response),
    metadata: {
      provider: "tavily",
      searchDepth: depth,
      resultCount: response.results?.length ?? 0,
      sources: (response.results ?? []).map((result) => result.url).filter((url): url is string => Boolean(url)),
      credits: response.usage?.credits,
      requestId: response.request_id,
    },
  })
}

function searchTool(id: "web_search" | "web_search_deep", depth: "basic" | "advanced", description: string) {
  return Effect.gen(function* () {
    const decode = Schema.decodeUnknownEffect(SearchParameters)
    return new Def({
      id,
      group: "research",
      description,
      parameters: SearchParameters,
      execute: (raw, ctx) => Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<SearchArgs>
        yield* ctx.ask({
          permission: id,
          patterns: [args.query],
          metadata: { query: args.query, topic: args.topic },
        })
        return yield* Effect.promise(() => search(args, depth, ctx.abort))
      }).pipe(Effect.orDie),
    })
  })
}

export const WebSearchTool = searchTool(
  "web_search",
  "basic",
  "Search the current public web with Tavily when the repository and existing context are insufficient. Use for focused, up-to-date facts, documentation discovery, release notes, API changes, and other external evidence. Prefer this basic search before deeper research.",
)

export const WebSearchDeepTool = searchTool(
  "web_search_deep",
  "advanced",
  "Run a deeper Tavily web search when a basic search is insufficient or the task requires broader evidence across multiple sources. This costs more research credits than web_search, so use it selectively.",
)

export const WebExtractTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(ExtractParameters)
  return new Def({
    id: "web_extract",
    group: "research",
    description: "Extract readable evidence from one or more known web URLs with Tavily. Use after search has identified relevant sources, or when precise current documentation must be read. Accepts up to 20 URLs and keeps output bounded for the model context.",
    parameters: ExtractParameters,
    execute: (raw, ctx) => Effect.gen(function* () {
      const args = yield* decode(raw) as Effect.Effect<ExtractArgs>
      const urls = args.urls.map((url) => url.trim()).filter(Boolean)
      if (urls.length === 0) return new Result({ title: "Error", output: "web_extract requires at least one URL." })
      if (urls.length > MAX_EXTRACT_URLS) {
        return new Result({ title: "Error", output: `web_extract accepts at most ${MAX_EXTRACT_URLS} URLs per call.` })
      }

      yield* ctx.ask({
        permission: "web_extract",
        patterns: urls,
        metadata: { urls, query: args.query, depth: args.depth },
      })

      const response = yield* Effect.promise(() => tavilyPost<TavilyExtractResponse>("/extract", {
        urls,
        query: args.query,
        chunks_per_source: args.query ? 3 : undefined,
        extract_depth: args.depth,
        format: "markdown",
        include_usage: true,
      }, ctx.abort))

      return new Result({
        title: `Extracted ${response.results?.length ?? 0} web source(s)`,
        output: formatExtractResponse(response),
        metadata: {
          provider: "tavily",
          extractDepth: args.depth,
          resultCount: response.results?.length ?? 0,
          failedCount: response.failed_results?.length ?? 0,
          sources: (response.results ?? []).map((result) => result.url).filter((url): url is string => Boolean(url)),
          credits: response.usage?.credits,
          requestId: response.request_id,
        },
      })
    }).pipe(Effect.orDie),
  })
})
