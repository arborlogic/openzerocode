import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import { spawnSync } from "child_process"

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
        const result = spawnSync("sh", ["-c", args.command], {
          encoding: "utf-8",
          timeout: args.timeout ?? 60000,
          maxBuffer: 10 * 1024 * 1024,
        })
        const stdout = result.stdout?.trim() ?? ""
        const stderr = result.stderr?.trim() ?? ""

        if (result.error) {
          return new Result({
            title: `Bash error: ${args.command}`,
            output: result.error.message || "command failed",
          })
        }

        if (result.status !== 0 && result.status !== null) {
          const message = stderr || stdout || `exit code ${result.status}`
          return new Result({
            title: `Bash error: ${args.command}`,
            output: message,
          })
        }

        return new Result({
          title: `Bash: ${args.command}`,
          output: stdout || "(no output)",
        })
      }).pipe(Effect.orDie),
  })
})
