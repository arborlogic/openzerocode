import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import { spawnSync } from "child_process"

const DEFAULT_TIMEOUT_MS = 60_000
const MIN_TIMEOUT_MS = 1_000

const Parameters = Schema.Struct({
  command: Schema.String,
  timeout: Schema.optional(
    Schema.Int.pipe(
      Schema.annotate({
        description: "Timeout in milliseconds. Values below 1000 are clamped to 1000 to avoid killing fast commands before they start.",
      }),
    ),
  ),
})
type Args = { command: string; timeout?: number }

function normalizeTimeout(timeout: number | undefined): number {
  if (timeout === undefined || timeout <= 0) return DEFAULT_TIMEOUT_MS
  return Math.max(timeout, MIN_TIMEOUT_MS)
}

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
          timeout: normalizeTimeout(args.timeout),
          maxBuffer: 10 * 1024 * 1024,
          cwd: ctx.cwd,
        })
        const stdout = result.stdout?.trim() ?? ""
        const stderr = result.stderr?.trim() ?? ""

        if (result.error) {
          const partialOutput = [stdout, stderr].filter(Boolean).join("\n")
          const message = [result.error.message || "command failed", partialOutput].filter(Boolean).join("\n")
          return new Result({
            title: `Bash error: ${args.command}`,
            output: message,
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
