import { Effect, Layer, Console } from "effect"
import { Provider } from "../provider/types"
import { bigPickleLayer } from "../provider/index"
import { ToolRegistry, layer as toolLayer } from "../tool/registry"
import { runLoop, type LoopConfig } from "../core/run-loop"
import type { Message } from "../provider/types"
import { createInterface } from "readline/promises"

const appLayer = Layer.merge(
  bigPickleLayer({
    apiKey: process.env.OPENCODE_API_KEY ?? "",
    model: process.env.OPENZERO_MODEL ?? "big-pickle",
  }),
  toolLayer,
)

function buildConfig(abort: AbortController): LoopConfig {
  return {
    cwd: process.cwd(),
    root: process.cwd(),
    abort: abort.signal,
    ask: (input) =>
      Effect.gen(function* () {
        yield* Console.log(`\n⚠  ${input.permission} requested: ${input.patterns.join(", ")}`)
        yield* Console.log("  → auto-approved (use --strict for prompting)")
      }),
    systemPrompt: [
      "You are openzerocode, an AI coding assistant.",
      "You have access to tools for reading, writing, searching files and running shell commands.",
      `Working directory: ${process.cwd()}`,
      "Be concise and helpful.",
    ].join("\n"),
  }
}

async function main() {
  const abort = new AbortController()
  const config = buildConfig(abort)

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  let messages: Message[] = []
  let first = true

  console.log("openzerocode — type your query (or 'exit' to quit)\n")

  let done = false
  process.stdin.on("end", () => { done = true })

  while (true) {
    let input: string
    try { input = await rl.question(first ? "" : "> ") } catch { break }
    first = false
    const trimmed = input.trim()
    if (!trimmed) { if (done) break; continue }
    if (trimmed === "exit" || trimmed === "quit") break

    const history = await Effect.runPromise(
      runLoop(trimmed, messages, config).pipe(Effect.provide(appLayer)),
    )

    messages = history
    const last = messages[messages.length - 1]
    if (last.content) {
      console.log(`\n${last.content}\n`)
    }
  }

  rl.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
