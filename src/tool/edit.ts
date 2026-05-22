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

export const EditTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "edit",
    description: "Replace text in a file using exact string matching. Use this to make targeted edits.",
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<Args>
        yield* ctx.ask({ permission: "edit", patterns: [args.filePath] })
        const target = resolve(ctx.cwd, args.filePath)
        const content = yield* Effect.promise(() => readFile(target, "utf-8"))

        if (args.replaceAll) {
          if (!content.includes(args.oldString)) {
            return new Result({ title: "Error", output: `oldString not found in file: ${args.filePath}` })
          }
          const updated = content.replaceAll(args.oldString, args.newString)
          const count = content.split(args.oldString).length - 1
          yield* Effect.promise(() => writeFile(target, updated, "utf-8"))
          return new Result({ title: "Edited", output: `Replaced ${count} occurrence(s) in ${args.filePath}` })
        }

        const idx = content.indexOf(args.oldString)
        if (idx === -1) {
          return new Result({ title: "Error", output: `oldString not found in file: ${args.filePath}` })
        }
        const updated = content.slice(0, idx) + args.newString + content.slice(idx + args.oldString.length)
        yield* Effect.promise(() => writeFile(target, updated, "utf-8"))
        return new Result({ title: "Edited", output: `Replaced 1 occurrence in ${args.filePath}` })
      }).pipe(Effect.orDie),
  })
})
