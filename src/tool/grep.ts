import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import { spawnSync } from "child_process"
import { readdir, readFile } from "fs/promises"
import path from "path"

const Parameters = Schema.Struct({
  pattern: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  path: Schema.optional(Schema.String),
  include: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
})
type Args = { pattern: string | string[]; path?: string; include?: string | string[] }

type SearchMatch = {
  file: string
  line: number
  text: string
}

function globToRegExp(pattern: string) {
  const normalized = pattern.split(path.sep).join("/")
  const escaped = normalized.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  return new RegExp(`^${escaped.replace(/\*\*/g, "::DOUBLE_STAR::").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/::DOUBLE_STAR::/g, ".*")}$`)
}

async function walkFiles(root: string, include?: string): Promise<string[]> {
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
      const relative = path.relative(root, full).split(path.sep).join("/")
      if (!includeRe || includeRe.test(relative)) {
        results.push(full)
      }
    }
  }

  await walk(root)
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
        const patterns = Array.isArray(args.pattern) ? args.pattern : [args.pattern]
        const includes = Array.isArray(args.include) ? args.include : args.include ? [args.include] : []
        yield* ctx.ask({ permission: "grep", patterns })
        const searchPath = path.resolve(ctx.cwd, args.path ?? ".")

        const stdout = yield* Effect.promise(async () => {
          const outputs: string[] = []
          for (const pat of patterns) {
            const rgArgs = ["-n", pat]
            for (const inc of includes) rgArgs.push("--glob", inc)
            rgArgs.push(searchPath)
            const result = spawnSync("rg", rgArgs, { encoding: "utf-8", cwd: searchPath })
            if (result.error?.name === "Error" && "code" in result.error && result.error.code === "ENOENT") {
              outputs.push(await searchWithFallback(pat, searchPath, includes[0]))
            } else if (result.error) {
              outputs.push(`rg failed: ${result.error.message}`)
            } else if (result.status === 0) {
              outputs.push(result.stdout || "(no matches)")
            } else if (result.status === 1) {
              outputs.push("(no matches)")
            } else {
              outputs.push(result.stderr?.trim() || result.stdout?.trim() || "(no matches)")
            }
          }
          const combined = outputs.filter(o => o !== "(no matches)").join("\n")
          return combined || "(no matches)"
        })
        return new Result({
          title: `Grep: ${patterns.join(", ")}`,
          output: stdout || "(no matches)",
        })
      }).pipe(Effect.orDie),
  })
})
