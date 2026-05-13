import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import { spawnSync } from "child_process"
import { readdir, readFile } from "fs/promises"
import path from "path"

const Parameters = Schema.Struct({
  pattern: Schema.String,
  path: Schema.optional(Schema.String),
  include: Schema.optional(Schema.String),
})
type Args = { pattern: string; path?: string; include?: string }

type SearchMatch = {
  file: string
  line: number
  text: string
}

function globToRegExp(pattern: string) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`)
}

async function walkFiles(dir: string, include?: string): Promise<string[]> {
  const results: string[] = []
  const includeRe = include ? globToRegExp(include) : undefined

  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!includeRe || includeRe.test(entry.name)) {
        results.push(full)
      }
    }
  }

  await walk(dir)
  return results
}

async function searchWithFallback(pattern: string, targetPath: string, include?: string): Promise<string> {
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
    ? matches.map((match) => `${match.file}:${match.line}:${match.text}`).join("\n")
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
        yield* ctx.ask({ permission: "grep", patterns: [args.pattern] })
        const searchPath = args.path ?? ctx.cwd
        const rgArgs = ["-n", args.pattern]
        if (args.include) rgArgs.push("--glob", args.include)
        rgArgs.push(searchPath)

        const stdout = yield* Effect.promise(async () => {
          const result = spawnSync("rg", rgArgs, { encoding: "utf-8" })
          if (result.error?.name === "Error" && "code" in result.error && result.error.code === "ENOENT") {
            return searchWithFallback(args.pattern, searchPath, args.include)
          }
          if (result.error) {
            return `rg failed: ${result.error.message}`
          }
          if (result.status === 0) {
            return result.stdout || "(no matches)"
          }
          if (result.status === 1) {
            return "(no matches)"
          }
          return result.stderr?.trim() || result.stdout?.trim() || "(no matches)"
        })
        return new Result({
          title: `Grep: ${args.pattern}`,
          output: stdout || "(no matches)",
        })
      }),
  })
})
