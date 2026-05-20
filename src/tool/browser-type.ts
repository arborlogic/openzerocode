import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import * as Geass from "../browser/geass-client"

const Parameters = Schema.Struct({
  text: Schema.String,
  targetLabel: Schema.optional(Schema.String),
  selectorHint: Schema.optional(Schema.String),
})

export const BrowserTypeTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "browser_type",
    description: [
      "Type text into an input field on the current page in the GEASS browser.",
      "Use targetLabel to match by visible label (e.g. 'Email', 'Password').",
      "Use selectorHint for a precise CSS selector.",
      "Requires GEASS desktop to be running.",
    ].join("\n"),
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<{ text: string; targetLabel?: string; selectorHint?: string }>

        yield* ctx.ask({
          permission: "browser_type",
          patterns: [],
          metadata: { targetLabel: args.targetLabel, selectorHint: args.selectorHint },
        })

        if (!Geass.isConnected()) {
          const msg = Geass.isEnabled() ? "GEASS Desktop is not running." : "GEASS is disabled. Enable it via the command palette."
          return new Result({ title: "GEASS Offline", output: msg })
        }

        const result = yield* Effect.promise(() => Geass.typeText(args))
        return new Result({
          title: result.ok ? "Typed" : "Type Failed",
          output: result.detail,
          metadata: { ok: result.ok },
        })
      }).pipe(Effect.orDie),
  })
})
