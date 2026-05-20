import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import * as Geass from "../browser/geass-client"

const Parameters = Schema.Struct({})

export const BrowserScreenshotTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "browser_screenshot",
    description: [
      "Take a screenshot of the current page in the GEASS browser.",
      "Returns a base64-encoded PNG image.",
      "Requires GEASS desktop to be running.",
    ].join("\n"),
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        yield* decode(raw) as Effect.Effect<{}>

        yield* ctx.ask({
          permission: "browser_screenshot",
          patterns: [],
          metadata: {},
        })

        if (!Geass.isConnected()) {
          const msg = Geass.isEnabled() ? "GEASS Desktop is not running." : "GEASS is disabled. Enable it via the command palette."
          return new Result({ title: "GEASS Offline", output: msg })
        }

        const result = yield* Effect.promise(() => Geass.screenshot())
        return new Result({
          title: "Screenshot",
          output: `![screenshot](data:image/png;base64,${result.base64})`,
        })
      }).pipe(Effect.orDie),
  })
})
