import { existsSync } from "fs"
import { mkdir, readFile, writeFile } from "fs/promises"
import { dirname, resolve } from "path"
import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import { findWorkspaceBoundary } from "../client/workspace-memory"

const Operation = Schema.Literals(["append", "replace"])
const Parameters = Schema.Struct({
  operation: Operation,
  content: Schema.String,
})

type Args = {
  operation: "append" | "replace"
  content: string
}

function normalizeContent(content: string): string {
  return content.trim() + "\n"
}

export const LearnProjectMemoryApplyTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "learn_project_memory_apply",
    description: "Apply a user-confirmed Learn mode project guidance update to <workspace>/DEVELOPMENT.md. Use this to extract relevant global/project experience into the current project only after explicit user confirmation.",
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<Args>
        const workspace = findWorkspaceBoundary(ctx.cwd)
        const target = resolve(workspace, "DEVELOPMENT.md")
        const displayTarget = target.startsWith(`${ctx.cwd}/`) ? target.replace(`${ctx.cwd}/`, "") : target
        const normalized = normalizeContent(args.content)

        yield* ctx.ask({ permission: "learn-project-memory", patterns: [target], metadata: { operation: args.operation } })

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

        return new Result({ title: "Project development memory updated", output })
      }).pipe(Effect.orDie),
  })
})
