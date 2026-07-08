import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import { spawn } from "child_process"
import { readdir, readFile } from "fs/promises"
import path from "path"

const Parameters = Schema.Struct({
  pattern: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  path: Schema.optional(Schema.String),
  include: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
})
type Args = { pattern: string | string[]; path?: string; include?: string | string[] }

const MAX_OUTPUT_BYTES = 1024 * 1024
const TRUNCATED_MESSAGE = `\n\n[output truncated after ${MAX_OUTPUT_BYTES} bytes]`

type SearchMatch = {
  file: string
  line: number
  text: string
}

type OutputBuffer = { text: string; bytes: number; truncated: boolean }

function appendOutput(buffer: OutputBuffer, chunk: Buffer | string) {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
  if (buffer.bytes >= MAX_OUTPUT_BYTES) {
    buffer.truncated = true
    return
  }
  const remaining = MAX_OUTPUT_BYTES - buffer.bytes
  if (bytes.byteLength <= remaining) {
    buffer.text += bytes.toString()
    buffer.bytes += bytes.byteLength
    return
  }
  buffer.text += bytes.subarray(0, remaining).toString()
  buffer.bytes = MAX_OUTPUT_BYTES
  buffer.truncated = true
}

function cappedText(buffer: OutputBuffer): string {
  return buffer.text + (buffer.truncated ? TRUNCATED_MESSAGE : "")
}

function capOutput(text: string): string {
  const buffer: OutputBuffer = { text: "", bytes: 0, truncated: false }
  appendOutput(buffer, text)
  return cappedText(buffer)
}

function globToRegExp(pattern: string) {
  const normalized = pattern.split(path.sep).join("/")
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^${escaped.replace(/\*\*/g, "::DOUBLE_STAR::").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/::DOUBLE_STAR::/g, ".*")}$`)
}

async function walkFiles(root: string, include?: string | string[]): Promise<string[]> {
  const results: string[] = []
  const includes = Array.isArray(include) ? include : include ? [include] : []
  const includeRes = includes.map(globToRegExp)

  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      const relative = path.relative(root, full).split(path.sep).join("/")
      if (includeRes.length === 0 || includeRes.some((includeRe) => includeRe.test(relative))) {
        results.push(full)
      }
    }
  }

  await walk(root)
  return results
}

function spawnRg(args: string[], cwd: string, abort: AbortSignal): Promise<{ stdout: string; stderr: string; status: number | null; error?: Error }> {
  return new Promise((resolve) => {
    if (abort.aborted) {
      resolve({ stdout: "", stderr: "", status: null, error: new Error("grep aborted") })
      return
    }

    const proc = spawn("rg", args, { cwd })
    const stdout: OutputBuffer = { text: "", bytes: 0, truncated: false }
    const stderr: OutputBuffer = { text: "", bytes: 0, truncated: false }
    let settled = false

    const settle = (result: { stdout: string; stderr: string; status: number | null; error?: Error }) => {
      if (settled) return
      settled = true
      abort.removeEventListener("abort", onAbort)
      resolve(result)
    }

    const onAbort = () => {
      proc.kill()
      settle({ stdout: cappedText(stdout), stderr: cappedText(stderr), status: null, error: new Error("grep aborted") })
    }
    abort.addEventListener("abort", onAbort, { once: true })

    proc.stdout.on("data", (chunk: Buffer) => { appendOutput(stdout, chunk) })
    proc.stderr.on("data", (chunk: Buffer) => { appendOutput(stderr, chunk) })
    proc.on("close", (code) => settle({ stdout: cappedText(stdout), stderr: cappedText(stderr), status: code }))
    proc.on("error", (err) => settle({ stdout: cappedText(stdout), stderr: cappedText(stderr), status: null, error: err }))
  })
}

async function searchWithFallback(pattern: string, targetPath: string, include?: string | string[]): Promise<string> {
  let regex: RegExp
  try {
    regex = new RegExp(pattern)
  } catch (error) {
    return `Invalid regex: ${error instanceof Error ? error.message : String(error)}`
  }

  const files = await walkFiles(targetPath, include)
  const matches: SearchMatch[] = []

  for (const file of files) {
    let content: string
    try {
      content = await readFile(file, "utf-8")
    } catch {
      continue
    }
    const lines = content.split("\n")
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] ?? ""
      regex.lastIndex = 0
      if (regex.test(line)) {
        matches.push({ file, line: index + 1, text: line })
      }
    }
  }

  return matches.length > 0
    ? capOutput(matches.map((match) => `${match.file}:${match.line}:${match.text}`).join("\n"))
    : "(no matches)"
}

export const GrepTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "grep",
    description: "Search file contents using a regex pattern",
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<Args>
        const patterns = Array.isArray(args.pattern) ? args.pattern : [args.pattern]
        const includes = Array.isArray(args.include) ? args.include : args.include ? [args.include] : []
        yield* ctx.ask({ permission: "grep", patterns })
        const searchPath = path.resolve(ctx.cwd, args.path ?? ".")

        const stdout = yield* Effect.promise(async () => {
          const outputs = await Promise.all(patterns.map(async (pat) => {
            const rgArgs = ["-n", pat]
            for (const inc of includes) rgArgs.push("--glob", inc)
            rgArgs.push(".")
            const result = await spawnRg(rgArgs, searchPath, ctx.abort)
            if (result.error && "code" in result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
              return searchWithFallback(pat, searchPath, includes)
            } else if (result.error) {
              return `rg failed: ${result.error.message}`
            } else if (result.status === 0) {
              return result.stdout.trim() || "(no matches)"
            } else if (result.status === 1) {
              return "(no matches)"
            } else {
              return result.stderr.trim() || result.stdout.trim() || "(no matches)"
            }
          }))
          const combined = outputs.filter(o => o !== "(no matches)").join("\n")
          return combined ? capOutput(combined) : "(no matches)"
        })
        return new Result({
          title: `Grep: ${patterns.join(", ")}`,
          output: stdout || "(no matches)",
        })
      }).pipe(Effect.orDie),
  })
})
