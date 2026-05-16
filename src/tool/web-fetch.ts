import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import TurndownService from "turndown"

const Parameters = Schema.Struct({
  url: Schema.String,
  format: Schema.Literals(["text", "markdown", "html"])
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("markdown" as const))),
  timeout: Schema.optional(Schema.Number),
})
type Args = {
  url: string
  format: "text" | "markdown" | "html"
  timeout?: number
}

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30_000 // 30 seconds
const MAX_TIMEOUT = 120_000 // 2 minutes

const turndownService = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
  emDelimiter: "*",
})

async function fetchUrl(url: string, timeout: number): Promise<string> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error("URL must start with http:// or https://")
  }

  const ua =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

  const acceptHeader =
    "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1"

  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(timeout),
    headers: {
      "User-Agent": ua,
      Accept: acceptHeader,
      "Accept-Language": "en-US,en;q=0.9",
    },
  })

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${response.statusText}${response.status === 403 ? " (possibly blocked by bot protection)" : ""}`,
    )
  }

  // Check content-length before reading body
  const contentLength = response.headers.get("content-length")
  if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
    throw new Error("Response too large (exceeds 5MB limit)")
  }

  const text = await response.text()

  if (text.length > MAX_RESPONSE_SIZE) {
    throw new Error("Response too large (exceeds 5MB limit)")
  }

  return text
}

function htmlToPlainText(html: string): string {
  // Use TurndownService to convert to markdown first, then strip markdown formatting
  const markdown = htmlToMarkdown(html)
  return markdown
    .replace(/#{1,6}\s/g, "")         // Remove heading markers
    .replace(/(\*{1,3}|_{1,3})/g, "") // Remove bold/italic markers
    .replace(/`{1,3}/g, "")           // Remove code markers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Replace links with just text
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1") // Replace images with alt text
    .replace(/>\s/g, "")              // Remove blockquote markers
    .replace(/^[-*+]\s/gm, "")        // Unordered list markers
    .replace(/^\d+\.\s/gm, "")        // Ordered list markers
    .replace(/\n{3,}/g, "\n\n")       // Collapse excess newlines
    .replace(/^---+$/gm, "")          // Remove horizontal rules
    .trim()
}

function htmlToMarkdown(html: string): string {
  turndownService.remove(["script", "style", "meta", "link", "noscript", "iframe"])
  return turndownService.turndown(html)
}

export const WebFetchTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "web_fetch",
    description: [
      "Fetch content from a URL and return it as readable text.",
      "",
      "Use this tool when you need to:",
      "- Read documentation for a package, library, framework, or API",
      "- Access a web page that the user has referenced",
      "- Look up information from online resources",
      "- Search the web (e.g., fetch a URL like https://www.google.com/search?q=...)",
      "",
      "Returns content in the requested format: markdown (default), text (plain), or html (raw).",
      "Supports URLs up to 5MB. Timeout defaults to 30s, configurable up to 120s.",
    ].join("\n"),
    parameters: Parameters,
    execute: (raw, _ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<Args>
        const timeout = Math.min(
          (args.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000,
          MAX_TIMEOUT,
        )

        const html = yield* Effect.promise(() => fetchUrl(args.url, timeout))

        let output: string
        switch (args.format) {
          case "html":
            output = html
            break
          case "text":
            output = htmlToPlainText(html)
            break
          case "markdown":
          default:
            output = htmlToMarkdown(html)
            break
        }

        return new Result({ title: `Fetched ${args.url}`, output })
      }).pipe(Effect.orDie),
  })
})
