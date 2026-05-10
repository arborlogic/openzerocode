import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import { execSync } from "child_process"

const Parameters = Schema.Struct({
  pattern: Schema.String,
  path: Schema.optional(Schema.String),
  include: Schema.optional(Schema.String),
})
type Args = { pattern: string; path?: string; include?: string }

export const GrepTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "grep",
    description: "Search file contents using a regex pattern",
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<Args>
        yield* ctx.ask({ permission: "grep", patterns: [args.pattern] })
        const cmd = ["rg", args.pattern, args.path ?? "."].filter(Boolean).join(" ")
        const stdout = yield* Effect.try({
          try: () => execSync(cmd, { encoding: "utf-8" }),
          catch: (e) => String(e),
        }).pipe(Effect.orDie)
        return new Result({
          title: `Grep: ${args.pattern}`,
          output: stdout || "(no matches)",
        })
      }),
  })
})
