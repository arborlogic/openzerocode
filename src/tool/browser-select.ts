import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import * as Geass from "../browser/geass-client"

const Parameters = Schema.Struct({
  value: Schema.String,
  targetLabel: Schema.optional(Schema.String),
  selectorHint: Schema.optional(Schema.String),
})

export const BrowserSelectTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "browser_select",
    group: "browser",
    description: [
      "Select an option from a dropdown/select element on the current page in the GEASS browser.",
      "Use value to specify the option text or value to select.",
      "Use targetLabel or selectorHint to identify the select element.",
      "Requires GEASS desktop to be running.",
    ].join("\n"),
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<{ value: string; targetLabel?: string; selectorHint?: string }>

        yield* ctx.ask({
          permission: "browser_select",
          patterns: [],
          metadata: { value: args.value, targetLabel: args.targetLabel },
        })

        if (!Geass.isConnected()) {
          const msg = Geass.isEnabled() ? "GEASS Desktop is not running." : "GEASS is disabled. Enable it via the command palette."
          return new Result({ title: "GEASS Offline", output: msg })
        }

        const result = yield* Effect.promise(() => Geass.selectOption(args))
        return new Result({
          title: result.ok ? "Selected" : "Select Failed",
          output: result.detail,
          metadata: { ok: result.ok },
        })
      }).pipe(Effect.orDie),
  })
})
