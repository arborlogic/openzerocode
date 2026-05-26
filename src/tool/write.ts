import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import { mkdir, writeFile } from "fs/promises"
import { dirname, resolve } from "path"

const Parameters = Schema.Struct({
  filePath: Schema.String,
  content: Schema.String,
})
type Args = { filePath: string; content: string }

export const WriteTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "write",
    description: "Write content to a file, overwriting if it exists",
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<Args>
        yield* ctx.ask({ permission: "write", patterns: [args.filePath] })
        const target = resolve(ctx.cwd, args.filePath)
        yield* Effect.promise(async () => {
          await mkdir(dirname(target), { recursive: true })
          await writeFile(target, args.content, "utf-8")
        })
        return new Result({ title: "Written", output: `Wrote ${args.filePath}` })
      }).pipe(Effect.orDie),
  })
})
