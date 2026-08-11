import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import { spawn } from "child_process"

const DEFAULT_TIMEOUT_MS = 60_000
const MIN_TIMEOUT_MS = 1_000
const MAX_OUTPUT_BYTES = 1024 * 1024
const TRUNCATED_MESSAGE = `\n\n[output truncated after ${MAX_OUTPUT_BYTES} bytes]`

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

type OutputBuffer = { text: string; bytes: number; truncated: boolean }

function appendOutput(buffer: OutputBuffer, chunk: Buffer) {
  if (buffer.bytes >= MAX_OUTPUT_BYTES) {
    buffer.truncated = true
    return
  }
  const remaining = MAX_OUTPUT_BYTES - buffer.bytes
  if (chunk.byteLength <= remaining) {
    buffer.text += chunk.toString()
    buffer.bytes += chunk.byteLength
    return
  }
  buffer.text += chunk.subarray(0, remaining).toString()
  buffer.bytes = MAX_OUTPUT_BYTES
  buffer.truncated = true
}

function bufferedText(buffer: OutputBuffer): string {
  return buffer.text + (buffer.truncated ? TRUNCATED_MESSAGE : "")
}

function killProcessTree(proc: ReturnType<typeof spawn>) {
  if (proc.pid && process.platform !== "win32") {
    try {
      process.kill(-proc.pid)
      return
    } catch {
      // Fall back to killing the direct child below.
    }
  }
  proc.kill()
}

function runCommand(
  command: string,
  timeoutMs: number,
  cwd: string,
  abort: AbortSignal,
): Promise<{ stdout: string; stderr: string; code: number | null; error?: Error }> {
  return new Promise((resolve) => {
    if (abort.aborted) {
      resolve({ stdout: "", stderr: "", code: null, error: new Error("Command aborted") })
      return
    }

    const proc = spawn("sh", ["-c", command], { cwd, detached: process.platform !== "win32" })
    const stdout: OutputBuffer = { text: "", bytes: 0, truncated: false }
    const stderr: OutputBuffer = { text: "", bytes: 0, truncated: false }
    let settled = false

    const settle = (result: { stdout: string; stderr: string; code: number | null; error?: Error }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      abort.removeEventListener("abort", onAbort)
      resolve(result)
    }

    proc.stdout.on("data", (chunk: Buffer) => {
      appendOutput(stdout, chunk)
    })
    proc.stderr.on("data", (chunk: Buffer) => {
      appendOutput(stderr, chunk)
    })

    const timer = setTimeout(() => {
      killProcessTree(proc)
      settle({ stdout: bufferedText(stdout).trim(), stderr: bufferedText(stderr).trim(), code: null, error: new Error(`Command timed out after ${timeoutMs}ms`) })
    }, timeoutMs)

    const onAbort = () => {
      killProcessTree(proc)
      settle({ stdout: bufferedText(stdout).trim(), stderr: bufferedText(stderr).trim(), code: null, error: new Error("Command aborted") })
    }
    abort.addEventListener("abort", onAbort, { once: true })

    proc.on("close", (code) => settle({ stdout: bufferedText(stdout).trim(), stderr: bufferedText(stderr).trim(), code }))
    proc.on("error", (err) => settle({ stdout: bufferedText(stdout).trim(), stderr: bufferedText(stderr).trim(), code: null, error: err }))
  })
}

export const BashTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "bash",
    description: [
      "Execute a shell command and return stdout/stderr.",
      "",
      "Runs via `sh -c` in the session cwd. Use this for builds, tests, git, file operations, or any CLI.",
      "",
      "Parameters:",
      "- command (string, required): the shell command line.",
      "- timeout (number, optional): timeout in milliseconds (min 1000, default 60000). The whole process group is killed on timeout/abort.",
      "",
      "Behavior:",
      `- Exit code 0 → stdout (or "(no output)" if empty). Non-zero → stderr (or stdout) is returned with an error title so failures are visible.`,
      "- Output is capped at 1MB; oversize output is truncated with a notice.",
      "",
      "Tips:",
      "- Chain related checks in one command (e.g. `npm run typecheck && npm test`) to save round-trips.",
      "- Prefer reading/editing files with `read`/`edit` over `cat`/`sed` so changes are tracked and permissioned.",
    ].join("\n"),
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<Args>
        yield* ctx.ask({ permission: "bash", patterns: [args.command] })
        const { stdout, stderr, code, error } = yield* Effect.promise(() =>
          runCommand(args.command, normalizeTimeout(args.timeout), ctx.cwd, ctx.abort),
        )

        if (error) {
          const partialOutput = [stdout, stderr].filter(Boolean).join("\n")
          const message = [error.message || "command failed", partialOutput].filter(Boolean).join("\n")
          return new Result({
            title: `Bash error: ${args.command}`,
            output: message,
          })
        }

        if (code !== 0 && code !== null) {
          const message = stderr || stdout || `exit code ${code}`
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
