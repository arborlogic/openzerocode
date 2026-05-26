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
    description: "Read the contents of a file",
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
        const offset = args.offset ?? 0
        const limit = args.limit ?? lines.length
        const snippet = lines.slice(offset, offset + limit).join("\n")
        return new Result({
          title: `Read ${args.filePath}`,
          output: snippet || "(empty file)",
          metadata: { totalLines: lines.length },
        })
      }).pipe(Effect.orDie),
  })
})
