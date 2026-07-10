import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import * as Geass from "../browser/geass-client"

const Parameters = Schema.Struct({})

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

const DEFAULT_SCREENSHOT_FORMAT: 'jpeg' | 'png' = process.env.OPENZEROCODE_SCREENSHOT_IMAGE_FORMAT === 'png' ? 'png' : 'jpeg'
const DEFAULT_SCREENSHOT_QUALITY = clampInt(process.env.OPENZEROCODE_SCREENSHOT_IMAGE_QUALITY, 72, 1, 100)
const DEFAULT_SCREENSHOT_MAX_LONG_EDGE = clampInt(process.env.OPENZEROCODE_SCREENSHOT_IMAGE_MAX_LONG_EDGE, 1280, 320, 4096)

export const BrowserScreenshotTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "browser_screenshot",
    group: "browser",
    description: [
      "Take a screenshot of the current page in the GEASS browser.",
      "Returns a bandwidth-conscious JPEG screenshot attachment by default (max long edge 1280px, quality 72).",
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

        const result = yield* Effect.promise(() => Geass.screenshot({
          format: DEFAULT_SCREENSHOT_FORMAT,
          quality: DEFAULT_SCREENSHOT_FORMAT === 'jpeg' ? DEFAULT_SCREENSHOT_QUALITY : undefined,
          maxLongEdge: DEFAULT_SCREENSHOT_MAX_LONG_EDGE,
        }))
        const details = [
          result.url ? `URL: ${result.url}` : undefined,
          result.title ? `Title: ${result.title}` : undefined,
          result.width && result.height ? `Image: ${result.width}x${result.height} ${result.format ?? 'png'}` : undefined,
          result.viewport ? `Viewport: ${result.viewport.width}x${result.viewport.height}+${result.viewport.x}+${result.viewport.y}${result.viewport.deviceScaleFactor === undefined ? '' : ` @${result.viewport.deviceScaleFactor}x`}` : undefined,
          result.capturedAt ? `Captured At: ${new Date(result.capturedAt).toISOString()}` : undefined,
        ].filter(Boolean).join('\n')

        return new Result({
          title: "Screenshot",
          output: details || "Screenshot captured.",
          images: [{ mimeType: result.format === 'jpeg' ? "image/jpeg" : "image/png", base64: result.base64 }],
          metadata: {
            url: result.url,
            width: result.width,
            height: result.height,
            originalWidth: result.originalWidth,
            originalHeight: result.originalHeight,
            resized: result.resized,
            format: result.format,
            quality: result.quality,
            viewport: result.viewport,
          },
        })
      }).pipe(Effect.orDie),
  })
})
