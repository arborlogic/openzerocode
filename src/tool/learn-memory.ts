import { existsSync } from "fs"
import { homedir } from "os"
import { mkdir, readFile, writeFile } from "fs/promises"
import { dirname, join, resolve } from "path"
import { Effect, Schema } from "effect"
import { Def, Result } from "./types"

const Target = Schema.Literals(["AGENTS.md", "CONTEXT.md"])
const Operation = Schema.Literals(["append", "replace"])
const Parameters = Schema.Struct({
  target: Target,
  operation: Operation,
  content: Schema.String,
})

type Args = {
  target: "AGENTS.md" | "CONTEXT.md"
  operation: "append" | "replace"
  content: string
}

function normalizeContent(content: string): string {
  return content.trim() + "\n"
}

function globalMemoryPath(target: Args["target"]): string {
  return resolve(join(process.env.HOME ?? homedir(), ".openzerocode", target))
}

export const LearnMemoryApplyTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "learn_memory_apply",
    description: "Apply a user-confirmed Learn mode memory update to global ~/.openzerocode/AGENTS.md or ~/.openzerocode/CONTEXT.md. Use only after explicit user confirmation.",
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<Args>
        const target = globalMemoryPath(args.target)
        const displayTarget = `~/.openzerocode/${args.target}`
        const normalized = normalizeContent(args.content)

        yield* ctx.ask({ permission: "learn-memory", patterns: [displayTarget], metadata: { operation: args.operation } })

        const output = yield* Effect.promise(async () => {
          await mkdir(dirname(target), { recursive: true })
          if (args.operation === "replace" || !existsSync(target)) {
            await writeFile(target, normalized, "utf-8")
            return `${args.operation === "replace" ? "Replaced" : "Created"} ${displayTarget}`
          }

          const current = await readFile(target, "utf-8")
          const next = current.trimEnd() + "\n\n" + normalized
          await writeFile(target, next, "utf-8")
          return `Appended to ${displayTarget}`
        })

        return new Result({ title: "Learn memory updated", output })
      }).pipe(Effect.orDie),
  })
})
