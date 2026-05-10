import { Effect, Console, Layer } from "effect"
import { bigPickleLayer } from "../provider/index"
import { layer as toolLayer } from "../tool/registry"
import { ToolRegistry } from "../tool/registry"
import { Provider } from "../provider/types"
import type { Message, ToolCall } from "../provider/types"
import { Context, Result } from "../tool/tool"
import { convertToolsToDefs, convertToolResult } from "../core/convert"
import { createInterface } from "readline/promises"
import chalk from "chalk"

const appLayer = Layer.merge(
  bigPickleLayer({
    apiKey: process.env.OPENCODE_API_KEY ?? "",
    model: process.env.OPENZERO_MODEL ?? "big-pickle",
  }),
  toolLayer,
)

const SYSTEM_PROMPT = [
  "You are openzerocode, an AI coding assistant.",
  "You have access to tools for reading, writing, searching files and running shell commands.",
  "Use tools when the user asks you to perform actions like running commands or accessing files.",
  "For simple conversation or questions, just respond directly without tools.",
  "Be concise and helpful.",
].join("\n")

function runSync<E, A>(effect: Effect.Effect<A, E, ToolRegistry | Provider>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(appLayer) as any))
}

async function askYN(rl: ReturnType<typeof createInterface>, label: string): Promise<boolean> {
  while (true) {
    const answer = await rl.question(chalk.yellow(`  Allow ${chalk.bold(label)}? `) + chalk.dim("[Y/n] "))
    const trimmed = answer.trim().toLowerCase()
    if (!trimmed || trimmed === "y" || trimmed === "yes") return true
    if (trimmed === "n" || trimmed === "no") return false
  }
}

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  let messages: Message[] = []
  let first = true
  const abort = new AbortController()
  process.stdin.on("end", () => abort.abort())

  console.log(chalk.bold("openzerocode") + chalk.dim(" — Ctrl+C to quit\n"))

  while (!abort.signal.aborted) {
    let input: string
    try { input = await rl.question(first ? "" : chalk.cyan("> ")) } catch { break }
    first = false
    const trimmed = input.trim()
    if (!trimmed) continue
    if (trimmed === "exit" || trimmed === "quit") break
    messages = await runSession(trimmed, messages, abort.signal, rl)
  }

  rl.close()
  process.stdin.destroy?.()
}

type AccToolCall = { id?: string; index?: number; name: string; arguments: string }

async function runSession(
  userInput: string,
  history: Message[],
  abort: AbortSignal,
  rl: ReturnType<typeof createInterface>,
): Promise<Message[]> {
  const systemMessage: Message = { role: "system", content: SYSTEM_PROMPT }
  const userMessage: Message = { role: "user", content: userInput }
  const allMessages: Message[] = [systemMessage, ...history, userMessage]
  const resultHistory: Message[] = [...history, userMessage]

  for (let step = 0; step < 50; step++) {
    const tools = await runSync(
      Effect.gen(function* () {
        const r = yield* ToolRegistry
        return yield* r.all()
      }),
    )
    const toolDefs = convertToolsToDefs(tools)

    const stream = await runSync(
      Effect.gen(function* () {
        const p = yield* Provider
        return yield* p.stream({
          model: "big-pickle",
          messages: allMessages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          stream: true,
        })
      }),
    )

    const reader = stream.getReader()
    let collectedContent = ""
    let collectedReasoning = ""
    const accToolCalls = new Map<number, AccToolCall>()
    let headerShown = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      if (value.delta.reasoning_content) {
        if (!headerShown) {
          process.stdout.write(chalk.dim(" ─ thinking\n"))
          headerShown = true
        }
        collectedReasoning += value.delta.reasoning_content
      }

      if (value.delta.content) {
        process.stdout.write(value.delta.content)
        collectedContent += value.delta.content
      }

      for (const tc of value.tool_calls ?? []) {
        const acc: AccToolCall = accToolCalls.get(tc.index ?? 0) ?? { name: "", arguments: "" }
        if (tc.id) acc.id = tc.id
        if (tc.function?.name) acc.name = tc.function.name
        if (tc.function?.arguments) acc.arguments += tc.function.arguments
        if (tc.index !== undefined) acc.index = tc.index
        accToolCalls.set(tc.index ?? 0, acc)
      }
    }

    const toolCalls: ToolCall[] | undefined = accToolCalls.size > 0
      ? [...accToolCalls.values()].map((a) => ({
          id: a.id ?? `call_${a.index ?? 0}`,
          type: "function" as const,
          function: { name: a.name, arguments: a.arguments },
        }))
      : undefined

    const assistantMsg: Message = {
      role: "assistant",
      content: collectedContent || undefined,
      reasoning_content: collectedReasoning || undefined,
      tool_calls: toolCalls,
    }
    allMessages.push(assistantMsg)
    resultHistory.push(assistantMsg)

    if (!toolCalls) {
      process.stdout.write("\n")
      return resultHistory
    }

    process.stdout.write("\n")

    for (const call of toolCalls) {
      const fnName = call.function.name ?? "unknown"
      const fnArgs = call.function.arguments ?? "{}"
      const args = tryParseJSON(fnArgs)
      const def = tools.find((t) => t.id === fnName)

      if (!def) {
        process.stdout.write(chalk.red(`  ✗ unknown tool: ${fnName}\n`))
        allMessages.push({ role: "tool", tool_call_id: call.id, content: `Unknown tool: ${fnName}` })
        continue
      }

      const allowed = await askYN(rl, fnName)
      if (!allowed) {
        process.stdout.write(chalk.dim(`  └ ${fnName} ${chalk.red("denied")}\n`))
        allMessages.push({ role: "tool", tool_call_id: call.id, content: "Permission denied" })
        continue
      }

      process.stdout.write(chalk.dim(`  └ ${fnName} `))

      const ctx = new Context({
        abort, cwd: process.cwd(), root: process.cwd(),
        ask: () => Effect.void,
        metadata: () => Effect.void,
      })

      const result = await Effect.runPromise(
        def.execute(args, ctx).pipe(Effect.catchCause((cause) =>
          Effect.succeed(new Result({ title: "Error", output: `Tool error: ${cause}` }))
        )),
      )

      process.stdout.write(chalk.green("✓\n"))
      const text = convertToolResult(result)
      const preview = text.length < 200 ? text : text.slice(0, 200) + chalk.dim("...")
      process.stdout.write(chalk.dim(`    ${preview}\n`))

      allMessages.push({ role: "tool", tool_call_id: call.id, content: text })
    }
    process.stdout.write("\n")
  }

  return resultHistory
}

function tryParseJSON(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) } catch { return {} }
}

main().catch((err) => { console.error(err); process.exit(1) })
