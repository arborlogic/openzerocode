import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import { mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

const Parameters = Schema.Struct({
  patchText: Schema.String,
})
type Args = { patchText: string }

type PatchFileChange =
  | { type: "add"; path: string; content: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; chunks: PatchChunk[] }

type PatchChunk = {
  oldLines: string[]
  newLines: string[]
}

function stripHeredoc(input: string) {
  const match = input.match(/^(?:cat\s+)?<<['"]?([A-Za-z0-9_]+)['"]?\s*\n([\s\S]*?)\n\1\s*$/)
  return match ? match[2] : input
}

function parsePatch(patchText: string): PatchFileChange[] {
  const lines = stripHeredoc(patchText.trim()).replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
  const beginIdx = lines.findIndex((line) => line.trim() === "*** Begin Patch")
  const endIdx = lines.findIndex((line) => line.trim() === "*** End Patch")
  if (beginIdx === -1 || endIdx === -1 || beginIdx >= endIdx) {
    throw new Error("Invalid patch format: missing Begin/End markers")
  }

  const changes: PatchFileChange[] = []
  let i = beginIdx + 1
  while (i < endIdx) {
    const line = lines[i]
    if (line.startsWith("*** Add File:")) {
      const path = line.slice("*** Add File:".length).trim()
      if (!path) throw new Error("Invalid add file header: missing path")
      i++
      const content: string[] = []
      while (i < endIdx && !lines[i].startsWith("*** ")) {
        const current = lines[i]
        content.push(current.startsWith("+") ? current.slice(1) : current)
        i++
      }
      changes.push({ type: "add", path, content: content.join("\n") + (content.length > 0 ? "\n" : "") })
      continue
    }

    if (line.startsWith("*** Delete File:")) {
      const path = line.slice("*** Delete File:".length).trim()
      if (!path) throw new Error("Invalid delete file header: missing path")
      changes.push({ type: "delete", path })
      i++
      continue
    }

    if (line.startsWith("*** Update File:")) {
      const path = line.slice("*** Update File:".length).trim()
      if (!path) throw new Error("Invalid update file header: missing path")
      i++
      const chunks: PatchChunk[] = []
      let current: PatchChunk | undefined

      const ensureChunk = () => {
        current ??= { oldLines: [], newLines: [] }
        return current
      }
      const flushChunk = () => {
        if (current && (current.oldLines.length > 0 || current.newLines.length > 0)) chunks.push(current)
        current = undefined
      }

      while (i < endIdx && !lines[i].startsWith("*** ")) {
        const currentLine = lines[i]
        if (currentLine.startsWith("@@")) {
          flushChunk()
          current = { oldLines: [], newLines: [] }
        } else if (currentLine.startsWith("+")) {
          ensureChunk().newLines.push(currentLine.slice(1))
        } else if (currentLine.startsWith("-")) {
          ensureChunk().oldLines.push(currentLine.slice(1))
        } else if (currentLine.startsWith(" ")) {
          const context = currentLine.slice(1)
          const chunk = ensureChunk()
          chunk.oldLines.push(context)
          chunk.newLines.push(context)
        } else if (currentLine === "") {
          const chunk = ensureChunk()
          chunk.oldLines.push("")
          chunk.newLines.push("")
        }
        i++
      }
      flushChunk()
      if (chunks.length === 0) throw new Error(`Invalid update for ${path}: no hunks found`)
      changes.push({ type: "update", path, chunks })
      continue
    }

    i++
  }

  if (changes.length === 0) throw new Error("Invalid patch format: no file changes found")
  return changes
}

function splitContent(content: string) {
  const lines = content.split("\n")
  const hadFinalNewline = lines.length > 0 && lines.at(-1) === ""
  if (hadFinalNewline) lines.pop()
  return { lines, hadFinalNewline }
}

function findSequence(lines: string[], sequence: string[], start: number) {
  if (sequence.length === 0) return start
  for (let i = start; i <= lines.length - sequence.length; i++) {
    let matched = true
    for (let j = 0; j < sequence.length; j++) {
      if (lines[i + j] !== sequence[j]) {
        matched = false
        break
      }
    }
    if (matched) return i
  }
  return -1
}

function applyChunks(content: string, chunks: PatchChunk[], path: string) {
  const original = splitContent(content)
  const lines = [...original.lines]
  let cursor = 0

  for (const chunk of chunks) {
    const idx = findSequence(lines, chunk.oldLines, cursor)
    if (idx === -1) {
      throw new Error(`Failed to apply patch to ${path}: hunk context not found`)
    }
    lines.splice(idx, chunk.oldLines.length, ...chunk.newLines)
    cursor = idx + chunk.newLines.length
  }

  const updated = lines.join("\n")
  return original.hadFinalNewline ? `${updated}\n` : updated
}

export const ApplyPatchTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "apply_patch",
    description: [
      "Apply a patch to create, update, or delete files using the OpenAI patch format.",
      "",
      "patchText markers:",
      "- `*** Begin Patch` / `*** End Patch` wrap the patch.",
      "- `*** Add File: <path>` followed by `+line` additions.",
      "- `*** Delete File: <path>`.",
      "- `*** Update File: <path>` with hunks starting at `@@`; lines prefixed ` ` (context), `-` (remove), `+` (add).",
      "",
      "Tips:",
      "- Context lines must match the file exactly. Re-read the file first.",
      "- Prefer `edit` for a single small change; use apply_patch for multi-file or multi-hunk changes.",
    ].join("\n"),
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<Args>
        let changes: PatchFileChange[]
        try {
          changes = parsePatch(args.patchText)
        } catch (error) {
          return new Result({ title: "Error", output: error instanceof Error ? error.message : String(error) })
        }

        yield* ctx.ask({ permission: "write", patterns: changes.map((change) => change.path) })

        for (const change of changes) {
          const target = resolve(ctx.cwd, change.path)
          if (change.type === "add") {
            yield* Effect.promise(async () => {
              await mkdir(dirname(target), { recursive: true })
              await writeFile(target, change.content, "utf-8")
            })
          } else if (change.type === "delete") {
            yield* Effect.promise(() => rm(target, { force: true }))
          } else {
            const content = yield* Effect.promise(() => readFile(target, "utf-8"))
            let updated: string
            try {
              updated = applyChunks(content, change.chunks, change.path)
            } catch (error) {
              return new Result({ title: "Error", output: error instanceof Error ? error.message : String(error) })
            }
            yield* Effect.promise(async () => {
              await mkdir(dirname(target), { recursive: true })
              await writeFile(target, updated, "utf-8")
            })
          }
        }

        const summary = changes.map((change) => `${change.type}: ${change.path}`).join("\n")
        return new Result({ title: "Patch Applied", output: summary })
      }).pipe(Effect.orDie),
  })
})
