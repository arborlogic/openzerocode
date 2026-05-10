import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import { execSync } from "child_process"

const Parameters = Schema.Struct({
  command: Schema.String,
  timeout: Schema.optional(Schema.Number),
})
type Args = { command: string; timeout?: number }

export const BashTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "bash",
    description: "Execute a shell command",
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<Args>
        yield* ctx.ask({ permission: "bash", patterns: [args.command] })
        const stdout = yield* Effect.try({
          try: () =>
            execSync(args.command, { encoding: "utf-8", timeout: args.timeout ?? 60000 }),
          catch: (e) => String(e),
        }).pipe(Effect.orDie)
        return new Result({
          title: `Bash: ${args.command}`,
          output: stdout || "(no output)",
        })
      }),
  })
})
