import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import { readFile, stat } from "fs/promises"
import { resolve } from "path"

const Parameters = Schema.Struct({
  filePath: Schema.String,
  offset: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
})
type Args = { filePath: string; offset?: number; limit?: number }

function fileExists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch(() => false)
}

export const ReadTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "read",
    description: [
      "Read a file from disk and return its contents WITH line numbers.",
      "",
      "Output format: a header line `<path> (<N> lines)` (or `lines X-Y of N` when paging with offset/limit), then each line shown as `<line>│ <content>` with a 1-based line number. Use these line numbers when planning edits.",
      "",
      "Parameters:",
      "- filePath (string, required): path to read. Relative paths resolve against the session cwd.",
      "- offset (number, optional): 0-based starting line index. Defaults to 0 (first line).",
      "- limit (number, optional): max number of lines to return. Defaults to the whole file.",
      "",
      "Tips:",
      "- For large files, page with offset/limit instead of dumping everything.",
      "- The `<line>│ ` prefix is NOT part of the file. When using `edit`/`apply_patch`, pass the real content without the prefix.",
      "- Always `read` the exact region before `edit` so your oldString matches character-for-character (whitespace, indentation, newlines).",
    ].join("\n"),
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<Args>
        yield* ctx.ask({ permission: "read", patterns: [args.filePath] })

        const target = resolve(ctx.cwd, args.filePath)
        const exists = yield* Effect.promise(() => fileExists(target))
        if (!exists) return new Result({ title: "Error", output: `File not found: ${args.filePath}` })

        const text = yield* Effect.promise(() => readFile(target, "utf-8"))
        const lines = text.split("\n")
        const totalLines = lines.length
        const offset = args.offset ?? 0
        const limit = args.limit ?? lines.length
        const end = Math.min(offset + limit, totalLines)
        const slice = lines.slice(offset, end)

        const fullFile = offset === 0 && end >= totalLines
        const header = fullFile
          ? `${args.filePath} (${totalLines} line${totalLines === 1 ? "" : "s"})`
          : `${args.filePath} (lines ${offset + 1}-${end} of ${totalLines})`

        let body: string
        if (text.length === 0) {
          body = "(empty file)"
        } else {
          const width = Math.max(1, String(totalLines).length)
          body = slice
            .map((line, i) => `${String(offset + i + 1).padStart(width)}│ ${line}`)
            .join("\n")
        }

        return new Result({
          title: `Read ${args.filePath}`,
          output: `${header}\n${body}`,
          metadata: { totalLines },
        })
      }).pipe(Effect.orDie),
  })
})
