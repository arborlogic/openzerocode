import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import * as Geass from "../browser/geass-client"

const Parameters = Schema.Struct({})

export const BrowserReadTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "browser_read",
    group: "browser",
    description: [
      "Read the current page content from the GEASS browser.",
      "Returns structured data: URL, title, headings, buttons, links, inputs, tables, and visible text.",
      "Requires GEASS desktop to be running.",
    ].join("\n"),
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        yield* decode(raw) as Effect.Effect<{}>

        yield* ctx.ask({
          permission: "browser_read",
          patterns: [],
          metadata: {},
        })

        if (!Geass.isConnected()) {
          const msg = Geass.isEnabled() ? "GEASS Desktop is not running." : "GEASS is disabled. Enable it via the command palette."
          return new Result({ title: "GEASS Offline", output: msg })
        }

        const page = yield* Effect.promise(() => Geass.readPage())

        const parts: string[] = []
        parts.push(`URL: ${page.url}`)
        parts.push(`Title: ${page.title}`)

        if (page.headings.length > 0) {
          parts.push('')
          parts.push('=== Headings ===')
          parts.push(page.headings.join('\n'))
        }

        if (page.structured?.elements && page.structured.elements.length > 0) {
          const elements = page.structured.elements
          const buttons = elements.filter(e => e.role === 'button' || e.role === 'link')
          const inputs = elements.filter(e => ['input', 'textarea', 'select', 'checkbox', 'radio'].includes(e.role))

          if (buttons.length > 0) {
            parts.push('')
            parts.push('=== Interactive Elements ===')
            for (const btn of buttons) {
              parts.push(`  [${btn.role}] ${btn.text || btn.label || btn.selectorHint || '?'}`)
            }
          }

          if (inputs.length > 0) {
            parts.push('')
            parts.push('=== Input Fields ===')
            for (const inp of inputs) {
              const label = inp.label || inp.placeholder || inp.ariaLabel || ''
              parts.push(`  [${inp.type || inp.role}] ${label}${inp.selectorHint ? ` (${inp.selectorHint})` : ''}`)
            }
          }
        }

        if (page.visibleTextSummary.length > 0) {
          parts.push('')
          parts.push('=== Page Text ===')
          parts.push(page.visibleTextSummary.slice(0, 20).join('\n'))
        }

        if (page.authFlow && page.authFlow.kind !== 'none') {
          parts.push('')
          parts.push(`=== Auth Detected: ${page.authFlow.kind} (${Math.round(page.authFlow.confidence * 100)}%) ===`)
          parts.push(`Signals: ${page.authFlow.signals.join(', ')}`)
        }

        return new Result({
          title: `Page: ${page.title || page.url}`,
          output: parts.join('\n') || '(empty page)',
          metadata: { url: page.url, elementCount: page.structured?.elements.length },
        })
      }).pipe(Effect.orDie),
  })
})
