import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import * as Geass from "../browser/geass-client"
import { analyzeImageWithLocalVlm, getDefaultLocalVlmEndpoint, getDefaultLocalVlmModel } from "../browser/local-vlm-client"

const Parameters = Schema.Struct({
  prompt: Schema.optional(Schema.NullOr(Schema.String)),
  analyzeWithLocalVlm: Schema.optional(Schema.Boolean),
  vlmEndpoint: Schema.optional(Schema.NullOr(Schema.String)),
  vlmModel: Schema.optional(Schema.NullOr(Schema.String)),
})

interface ParametersType {
  prompt?: string | null
  analyzeWithLocalVlm?: boolean
  vlmEndpoint?: string | null
  vlmModel?: string | null
}

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

const DEFAULT_VLM_IMAGE_FORMAT: 'jpeg' | 'png' = (process.env.OPENZEROCODE_VLM_IMAGE_FORMAT === 'png' ? 'png' : 'jpeg')
const DEFAULT_VLM_IMAGE_QUALITY = clampInt(process.env.OPENZEROCODE_VLM_IMAGE_QUALITY, 72, 1, 100)
const DEFAULT_VLM_IMAGE_MAX_LONG_EDGE = clampInt(process.env.OPENZEROCODE_VLM_IMAGE_MAX_LONG_EDGE, 1280, 320, 4096)

const DEFAULT_VISUAL_PROMPT = [
  'Describe the current browser screenshot for an automation agent.',
  'Focus on visible dialogs, overlays, selected/disabled states, layout problems, icons, charts, images, and controls that may not be captured by the DOM text.',
  'If an action target is visible, mention the safest DOM-like label or selector hint from the structured context when possible.',
  'Be factual and say when visual details are uncertain. Keep the answer concise and do not repeat the same sentence.',
].join(' ')

function formatPageSummary(page: Geass.PageSnapshot): string {
  const parts: string[] = []
  parts.push(`URL: ${page.url}`)
  parts.push(`Title: ${page.title}`)

  if (page.headings.length > 0) {
    parts.push('')
    parts.push('=== Headings ===')
    parts.push(page.headings.slice(0, 12).join('\n'))
  }

  if (page.structured?.elements && page.structured.elements.length > 0) {
    const visible = page.structured.elements.filter((e) => e.visible).slice(0, 30)
    if (visible.length > 0) {
      parts.push('')
      parts.push('=== Visible Interactive Elements ===')
      for (const el of visible) {
        const label = el.text || el.label || el.ariaLabel || el.placeholder || el.selectorHint || '?'
        parts.push(`  [${el.role}] ${label}${el.selectorHint ? ` (${el.selectorHint})` : ''}`)
      }
    }
  }

  if (page.visibleTextSummary.length > 0) {
    parts.push('')
    parts.push('=== Page Text ===')
    parts.push(page.visibleTextSummary.slice(0, 12).join('\n'))
  }

  return parts.join('\n')
}

function buildVisualPrompt(userPrompt: string | null | undefined, pageSummary: string): string {
  return [
    userPrompt?.trim() || DEFAULT_VISUAL_PROMPT,
    '',
    'Structured page context from GEASS:',
    pageSummary,
  ].join('\n')
}

export const BrowserObserveVisualTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "browser_observe_visual",
    group: "browser",
    description: [
      "Capture the current GEASS browser view for visual inspection.",
      "Returns structured page context and viewport metadata, plus either a local VLM analysis or a PNG screenshot data URL.",
      "Set analyzeWithLocalVlm=true to ask the configured local VLM (default http://10.66.66.5:8080) for a textual visual description.",
      "Use after browser_read when visual state matters (canvas, layout, dialogs, QR codes, hidden overlays).",
      "Requires GEASS desktop to be running.",
    ].join("\n"),
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<ParametersType>

        yield* ctx.ask({
          permission: "browser_screenshot",
          patterns: [],
          metadata: { visualObservation: true, localVlm: args.analyzeWithLocalVlm === true },
        })

        if (!Geass.isConnected()) {
          const msg = Geass.isEnabled() ? "GEASS Desktop is not running." : "GEASS is disabled. Enable it via the command palette."
          return new Result({ title: "GEASS Offline", output: msg })
        }

        const observation = yield* Effect.promise(() => Geass.observeVisual(args.analyzeWithLocalVlm === true ? {
          screenshot: {
            format: DEFAULT_VLM_IMAGE_FORMAT,
            quality: DEFAULT_VLM_IMAGE_FORMAT === 'jpeg' ? DEFAULT_VLM_IMAGE_QUALITY : undefined,
            maxLongEdge: DEFAULT_VLM_IMAGE_MAX_LONG_EDGE,
          },
        } : undefined))
        const screenshot = observation.screenshot
        const pageSummary = formatPageSummary(observation.page)
        const metadataLines = [
          `URL: ${screenshot.url || observation.page.url}`,
          `Title: ${screenshot.title || observation.page.title}`,
          `Image: ${screenshot.width ?? '?'}x${screenshot.height ?? '?'} ${screenshot.format ?? 'png'}${screenshot.resized ? ` (resized from ${screenshot.originalWidth}x${screenshot.originalHeight})` : ''}${screenshot.quality ? ` q=${screenshot.quality}` : ''}`,
        ]

        if (screenshot.viewport) {
          const dpr = screenshot.viewport.deviceScaleFactor === undefined ? '' : ` @${screenshot.viewport.deviceScaleFactor}x`
          metadataLines.push(`Viewport: ${screenshot.viewport.width}x${screenshot.viewport.height}+${screenshot.viewport.x}+${screenshot.viewport.y}${dpr}`)
        }

        if (screenshot.capturedAt) {
          metadataLines.push(`Captured At: ${new Date(screenshot.capturedAt).toISOString()}`)
        }

        const outputParts = [metadataLines.join('\n')]
        const metadata: Record<string, unknown> = {
          url: screenshot.url || observation.page.url,
          width: screenshot.width,
          height: screenshot.height,
          viewport: screenshot.viewport,
          elementCount: observation.page.structured?.elements.length,
        }

        if (args.analyzeWithLocalVlm === true) {
          try {
            let geassVlm: Geass.VlmSettings | undefined
            if (!args.vlmEndpoint || !args.vlmModel) {
              try {
                geassVlm = yield* Effect.promise(() => Geass.getVlmSettings())
              } catch {
                // Older GEASS Desktop versions may not expose VLM settings yet; use local env/defaults below.
              }
            }
            const endpoint = args.vlmEndpoint || geassVlm?.endpoint || getDefaultLocalVlmEndpoint()
            const model = args.vlmModel || geassVlm?.model || getDefaultLocalVlmModel()
            const timeoutMs = geassVlm?.timeoutMs

            if (geassVlm && geassVlm.enabled === false && !args.vlmEndpoint) {
              throw new Error('Local VLM analysis is disabled in GEASS Desktop settings. Provide vlmEndpoint to override or enable VLM in GEASS settings.')
            }

            const analysis = yield* Effect.promise(() => analyzeImageWithLocalVlm({
              endpoint,
              model,
              timeoutMs,
              prompt: buildVisualPrompt(args.prompt, pageSummary),
              imageBase64: screenshot.base64,
              imageFormat: screenshot.format,
            }))
            outputParts.push(
              '',
              '=== Local VLM Visual Analysis ===',
              analysis.text,
              '',
              `VLM: ${analysis.endpoint} (${analysis.api}${analysis.model ? `, model=${analysis.model}` : ''})`,
            )
            metadata.localVlm = { endpoint: analysis.endpoint, api: analysis.api, model: analysis.model, ok: true }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            outputParts.push(
              '',
              '=== Local VLM Visual Analysis Failed ===',
              message,
              '',
              'Falling back to screenshot data URL for a vision-capable model or human-visible transcript.',
              '',
              `![screenshot](data:image/${screenshot.format === 'jpeg' ? 'jpeg' : 'png'};base64,${screenshot.base64})`,
            )
            metadata.localVlm = { endpoint: args.vlmEndpoint || getDefaultLocalVlmEndpoint(), model: args.vlmModel || getDefaultLocalVlmModel(), ok: false, error: message }
          }
        } else {
          outputParts.push(
            '',
            `![screenshot](data:image/${screenshot.format === 'jpeg' ? 'jpeg' : 'png'};base64,${screenshot.base64})`,
          )
        }

        outputParts.push(
          '',
          '=== Structured Page Context ===',
          pageSummary,
        )

        return new Result({
          title: `Visual Observation: ${screenshot.title || observation.page.title || observation.page.url}`,
          output: outputParts.join('\n'),
          metadata,
        })
      }).pipe(Effect.orDie),
  })
})
