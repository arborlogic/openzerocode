import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import { readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const Parameters = Schema.Struct({
  filePath: Schema.String,
  oldString: Schema.String,
  newString: Schema.String,
  replaceAll: Schema.Boolean,
})
type Args = { filePath: string; oldString: string; newString: string; replaceAll: boolean }

/**
 * When `oldString` is not found, build a short list of the closest matching
 * lines (with line numbers) so the caller can correct oldString without a
 * separate read round-trip.
 */
function suggestLines(content: string, oldString: string, max = 8): string {
  const lines = content.split("\n")
  const anchors = oldString.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
  const anchor = anchors[0] ?? oldString.trim()
  if (!anchor) return ""

  const tokens = anchor.split(/\s+/).filter((t) => t.length >= 3)
  const candidates: { line: number; text: string; score: number }[] = []
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const lt = raw.trim()
    if (lt.length === 0) continue
    let score = 0
    if (lt.includes(anchor) || anchor.includes(lt)) {
      score = 3
    } else if (tokens.length > 0) {
      const hits = tokens.filter((t) => lt.includes(t)).length
      if (hits > 0) score = hits >= 2 ? 2 : 1
    }
    if (score > 0) candidates.push({ line: i + 1, text: raw, score })
  }
  if (candidates.length === 0) return ""
  candidates.sort((a, b) => b.score - a.score || a.line - b.line)
  const top = candidates.slice(0, max)
  const width = Math.max(1, String(lines.length).length)
  return top
    .map((c) => `  ${String(c.line).padStart(width)}│ ${c.text.length > 120 ? c.text.slice(0, 120) + "…" : c.text}`)
    .join("\n")
}

function notFoundResult(filePath: string, content: string, oldString: string): Result {
  const suggest = suggestLines(content, oldString)
  const hint = suggest
    ? `Nearest candidate lines:\n${suggest}\n\nRe-read the file to copy the exact text (whitespace and indentation must match).`
    : `Re-read the file with \`read\` to get the exact text, then retry.`
  return new Result({ title: "Error", output: `oldString not found in file: ${filePath}\n\n${hint}` })
}

export const EditTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "edit",
    description: [
      "Replace an EXACT substring in a file with new text. The file is modified in place.",
      "",
      "Parameters:",
      "- filePath (string, required): target file (relative to session cwd).",
      "- oldString (string, required): exact current file text to replace; whitespace and newlines must match. Read the file first.",
      "- newString (string, required): replacement text.",
      "- replaceAll (boolean, required): true = replace every occurrence; false = replace only the first.",
      "",
      "Behavior & tips:",
      "- To target one occurrence among many, include enough surrounding context in oldString to make it unique.",
      "- On failure, nearby candidate lines are shown so you can fix oldString.",
      "- Do not include the `N│ ` line-number prefix printed by `read`; use real file content.",
      `- To insert, repeat an anchor line in oldString and append new content in newString. To delete, set newString to "".`,
    ].join("\n"),
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<Args>
        yield* ctx.ask({ permission: "edit", patterns: [args.filePath] })
        const target = resolve(ctx.cwd, args.filePath)
        const content = yield* Effect.promise(() => readFile(target, "utf-8"))

        if (args.replaceAll) {
          if (!content.includes(args.oldString)) {
            return notFoundResult(args.filePath, content, args.oldString)
          }
          const updated = content.replaceAll(args.oldString, args.newString)
          const count = content.split(args.oldString).length - 1
          yield* Effect.promise(() => writeFile(target, updated, "utf-8"))
          return new Result({ title: "Edited", output: `Replaced ${count} occurrence(s) in ${args.filePath}` })
        }

        const idx = content.indexOf(args.oldString)
        if (idx === -1) {
          return notFoundResult(args.filePath, content, args.oldString)
        }
        const updated = content.slice(0, idx) + args.newString + content.slice(idx + args.oldString.length)
        yield* Effect.promise(() => writeFile(target, updated, "utf-8"))
        const total = content.split(args.oldString).length - 1
        const note = total > 1 ? ` (1 of ${total} matches; set replaceAll=true to replace all)` : ""
        return new Result({ title: "Edited", output: `Replaced 1 occurrence in ${args.filePath}${note}` })
      }).pipe(Effect.orDie),
  })
})
