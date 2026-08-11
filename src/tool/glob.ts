import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import { readdir } from "fs/promises"
import path from "path"

const Parameters = Schema.Struct({
  pattern: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
  path: Schema.optional(Schema.String),
})
type Args = { pattern: string | string[]; path?: string }

function matchGlob(pattern: string, candidate: string): boolean {
  const segments = pattern.split("/")
  const target = candidate.split(path.sep).join("/")

  const segmentToRegex = (segment: string) => segment
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")

  const regexSource = segments.map((segment) => {
    if (segment === "**") return ".*"
    return segmentToRegex(segment)
  }).join("/")

  return new RegExp(`^${regexSource}$`).test(target)
}

async function walkFiles(root: string, searchRoot: string, pattern: string): Promise<string[]> {
  const results: string[] = []

  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue
        await walk(full)
      } else {
        const relative = path.relative(root, full)
        if (matchGlob(pattern, relative)) {
          results.push(full)
        }
      }
    }
  }

  await walk(searchRoot)
  return results
}

export const GlobTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "glob",
    description: [
      "Find files by glob pattern. Returns matching file paths (absolute), one per line. Skips dotfiles and node_modules.",
      "",
      "Parameters:",
      `- pattern (string | string[], required): one or more glob patterns, e.g. "src/**/*.ts". \`*\` matches within a path segment; \`**\` matches across segments.`,
      `- path (string, optional): directory to search in, relative to session cwd. Defaults to ".".`,
      "",
      "Tips:",
      "- Use `**/*.ext` to find all files of an extension under a tree.",
      "- Combine with `grep` to locate content within matched files.",
    ].join("\n"),
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<Args>
        const patterns = Array.isArray(args.pattern) ? args.pattern : [args.pattern]
        yield* ctx.ask({ permission: "glob", patterns })
        const searchRoot = path.resolve(ctx.cwd, args.path ?? ".")
        const allPaths = yield* Effect.promise(() =>
          Promise.all(patterns.map((p) => walkFiles(searchRoot, searchRoot, p)))
            .then((results) => [...new Set(results.flat())])
        )
        return new Result({
          title: `Glob: ${patterns.join(", ")}`,
          output: allPaths.length > 0 ? allPaths.join("\n") : "(no matches)",
        })
      }).pipe(Effect.orDie),
  })
})
