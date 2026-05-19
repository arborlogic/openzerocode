import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import * as Geass from "../browser/geass-client"

const Parameters = Schema.Struct({
  targetLabel: Schema.optional(Schema.String),
  selectorHint: Schema.optional(Schema.String),
})

export const BrowserClickTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "browser_click",
    description: [
      "Click an element on the current page in the GEASS browser.",
      "Use targetLabel to match by visible text (e.g. 'Sign In', 'Submit').",
      "Use selectorHint for a precise CSS selector.",
      "Requires GEASS desktop to be running.",
    ].join("\n"),
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<{ targetLabel?: string; selectorHint?: string }>

        yield* ctx.ask({
          permission: "browser_click",
          patterns: [],
          metadata: { targetLabel: args.targetLabel, selectorHint: args.selectorHint },
        })

        if (!Geass.isConnected()) {
          const msg = Geass.isEnabled() ? "GEASS Desktop is not running." : "GEASS is disabled. Enable it via the command palette."
          return new Result({ title: "GEASS Offline", output: msg })
        }

        const result = yield* Effect.promise(() => Geass.click(args))
        return new Result({
          title: result.ok ? "Clicked" : "Click Failed",
          output: result.detail,
          metadata: { ok: result.ok },
        })
      }).pipe(Effect.orDie),
  })
})
