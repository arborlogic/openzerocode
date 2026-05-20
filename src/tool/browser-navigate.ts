import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import * as Geass from "../browser/geass-client"

const Parameters = Schema.Struct({
  url: Schema.String,
})

export const BrowserNavigateTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "browser_navigate",
    description: [
      "Navigate the GEASS browser to a URL.",
      "Requires GEASS desktop to be running.",
      "Use this tool when you need to visit a web page.",
    ].join("\n"),
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<{ url: string }>

        yield* ctx.ask({
          permission: "browser_navigate",
          patterns: [args.url],
          metadata: { url: args.url },
        })

        if (!Geass.isConnected()) {
          const msg = Geass.isEnabled() ? "GEASS Desktop is not running." : "GEASS is disabled. Enable it via the command palette."
          return new Result({ title: "GEASS Offline", output: msg })
        }

        const result = yield* Effect.promise(() => Geass.navigate(args.url))
        return new Result({
          title: `Navigated to ${args.url}`,
          output: result.ok ? `Navigated to ${args.url}` : `Navigation failed`,
          metadata: { tab: result.tab },
        })
      }).pipe(Effect.orDie),
  })
})
