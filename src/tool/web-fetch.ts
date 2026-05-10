import { Effect, Schema } from "effect"
import { Def, Context, Result } from "./types"

const Parameters = Schema.Struct({
  url: Schema.String,
  format: Schema.String,
})
type Args = { url: string; format: string }

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  return response.text()
}

export const WebFetchTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "web_fetch",
    description: "Fetch content from a URL. Returns the content in the requested format (markdown, text, or html).",
    parameters: Parameters,
    execute: (raw, _ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<Args>
        const html = yield* Effect.promise(() => fetchText(args.url))
        const output = args.format === "html" ? html
          : args.format === "text" ? html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
          : html // markdown — return raw, let LLM handle conversion
        return new Result({ title: `Fetched ${args.url}`, output: output.slice(0, 50000) })
      }).pipe(Effect.orDie),
  })
})
