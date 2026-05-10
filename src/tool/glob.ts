import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import { readdir } from "fs/promises"
import path from "path"

const Parameters = Schema.Struct({
  pattern: Schema.String,
  path: Schema.optional(Schema.String),
})
type Args = { pattern: string; path?: string }

function matchGlob(pattern: string, name: string): boolean {
  const re = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$")
  return re.test(name)
}

async function walkFiles(dir: string, pattern: string, abs: boolean): Promise<string[]> {
  const results: string[] = []
  async function walk(d: string) {
    const entries = await readdir(d, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(d, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue
        await walk(full)
      } else if (matchGlob(pattern, entry.name)) {
        results.push(abs ? full : entry.name)
      }
    }
  }
  await walk(dir)
  return results
}

export const GlobTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "glob",
    description: "Find files by glob pattern",
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<Args>
        yield* ctx.ask({ permission: "glob", patterns: [args.pattern] })
        const cwd = args.path ?? ctx.cwd
        const paths = yield* Effect.promise(() => walkFiles(cwd, args.pattern, true))
        return new Result({
          title: `Glob: ${args.pattern}`,
          output: paths.length > 0 ? paths.join("\n") : "(no matches)",
        })
      }),
  })
})
