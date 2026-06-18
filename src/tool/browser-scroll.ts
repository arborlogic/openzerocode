import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import * as Geass from "../browser/geass-client"

const Parameters = Schema.Struct({
  direction: Schema.Literals(["up", "down", "top", "bottom"]).pipe(
    Schema.optional,
    Schema.withDecodingDefault(Effect.succeed("down" as const)),
  ),
  amount: Schema.optional(Schema.Number),
})

export const BrowserScrollTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "browser_scroll",
    group: "browser",
    description: [
      "Scroll the current page in the GEASS browser.",
      "Direction: up, down, top, or bottom. Amount is in pixels (default: 300).",
      "Requires GEASS desktop to be running.",
    ].join("\n"),
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<{ direction: 'up' | 'down' | 'top' | 'bottom'; amount?: number }>

        yield* ctx.ask({
          permission: "browser_scroll",
          patterns: [],
          metadata: { direction: args.direction, amount: args.amount },
        })

        if (!Geass.isConnected()) {
          const msg = Geass.isEnabled() ? "GEASS Desktop is not running." : "GEASS is disabled. Enable it via the command palette."
          return new Result({ title: "GEASS Offline", output: msg })
        }

        const result = yield* Effect.promise(() => Geass.scroll(args))
        return new Result({
          title: "Scrolled",
          output: result.detail,
          metadata: { ok: result.ok },
        })
      }).pipe(Effect.orDie),
  })
})
