import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import * as Geass from "../browser/geass-client"

const Parameters = Schema.Struct({})

export const BrowserScreenshotTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "browser_screenshot",
    group: "browser",
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
        const details = [
          result.url ? `URL: ${result.url}` : undefined,
          result.title ? `Title: ${result.title}` : undefined,
          result.width && result.height ? `Image: ${result.width}x${result.height} ${result.format ?? 'png'}` : undefined,
          result.viewport ? `Viewport: ${result.viewport.width}x${result.viewport.height}+${result.viewport.x}+${result.viewport.y}${result.viewport.deviceScaleFactor === undefined ? '' : ` @${result.viewport.deviceScaleFactor}x`}` : undefined,
          result.capturedAt ? `Captured At: ${new Date(result.capturedAt).toISOString()}` : undefined,
        ].filter(Boolean).join('\n')

        return new Result({
          title: "Screenshot",
          output: `${details ? `${details}\n\n` : ''}![screenshot](data:image/png;base64,${result.base64})`,
          metadata: {
            url: result.url,
            width: result.width,
            height: result.height,
            viewport: result.viewport,
          },
        })
      }).pipe(Effect.orDie),
  })
})
