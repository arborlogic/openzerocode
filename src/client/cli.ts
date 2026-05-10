import { Effect, Layer } from "effect"
import { bigPickleLayer } from "../provider/index"
import { layer as toolLayer } from "../tool/registry"
import { ToolRegistry } from "../tool/registry"
import { Provider } from "../provider/types"
import type { Message, ToolCall } from "../provider/types"
import { Context, Result } from "../tool/tool"
import { convertToolsToDefs, convertToolResult } from "../core/convert"
import chalk from "chalk"
import { renderMarkdown } from "./markdown"
import { delay, formatProviderError, isRateLimitError } from "./errors"
import { InputController, Screen } from "./ui"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

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

const SESSION_DIR = join(homedir(), ".openzerocode", "sessions")
const SESSION_FILE = join(SESSION_DIR, "last.json")

function ensureSessionDir() {
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true })
}

function saveSession(messages: Message[]) {
  ensureSessionDir()
  const session = { messages, updatedAt: Date.now() }
  writeFileSync(SESSION_FILE, JSON.stringify(session), "utf-8")
}

function loadSession(): Message[] {
  try {
    if (!existsSync(SESSION_FILE)) return []
    const data = readFileSync(SESSION_FILE, "utf-8")
    return JSON.parse(data).messages ?? []
  } catch { return [] }
}

type AccToolCall = { id?: string; index?: number; name: string; arguments: string }

function runSync<E, A>(effect: Effect.Effect<A, E, ToolRegistry | Provider>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(appLayer)))
}

function tryParseJSON(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) } catch { return {} }
}

function printHelp() {
  // kept for compatibility when running outside fullscreen mode
}

function helpLines() {
  return [
    "Commands:",
    "  /help   show this help",
    "  /clear  clear conversation history",
    "  /info   show session info",
    "  /enter submit   Enter=submit, Ctrl+N=newline",
    "  /enter newline  Enter=newline, Ctrl+Enter/Ctrl+N=submit",
    "  /exit   exit program",
    "Input:",
    "  multi-line input enabled",
    "  empty line to submit",
    "  PgUp/PgDn to scroll response",
  ]
}

async function main() {
  const abort = new AbortController()
  const screen = new Screen()
  const enterMode = (process.env.OPENZEROCODE_ENTER_MODE ?? "submit").toLowerCase() === "newline" ? "newline" : "submit"
  const input = new InputController(screen, abort, enterMode)
  process.stdout.write("\x1b[?1049h")
  process.stdin.on("end", () => abort.abort())

  let messages: Message[] = loadSession()
  let historyCount = messages.length

  const autoApprove = ["true", "1", "yes"].includes((process.env.OPENZEROCODE_AUTO_APPROVE ?? "").toLowerCase())
  const retry429 = ["true", "1", "yes"].includes((process.env.OPENZEROCODE_RETRY_429 ?? "").toLowerCase())
  let autoApproved = false
  screen.setFlags({ autoApprove, retry429, enterMode: input.getEnterMode() })
  if (autoApprove) {
    autoApproved = await input.readConfirm("Auto-approve all tool calls?")
    screen.setFlags({ autoApprove: autoApproved, retry429, enterMode: input.getEnterMode() })
  }

  screen.render()
  screen.append(chalk.bold("openzerocode") + chalk.dim(" — /help for commands"))

  if (historyCount > 0) {
    screen.append(chalk.dim(`Resumed session with ${historyCount} message(s). /clear to reset.`))
  }

  while (!abort.signal.aborted) {
    screen.setStatus("waiting for input")
    const prompt = await input.readPrompt()
    if (abort.signal.aborted) break

    const trimmed = prompt.trim()
    if (!trimmed) continue

    if (trimmed.startsWith("/")) {
      switch (trimmed) {
        case "/help":
          screen.addTool("help")
          for (const line of helpLines()) screen.append(chalk.hex("#A8B0BE")(line))
          screen.append("")
          continue
        case "/enter submit":
          input.setEnterMode("submit")
          screen.setFlags({ autoApprove: autoApproved, retry429, enterMode: "submit" })
          screen.addTool("enter mode: submit")
          continue
        case "/enter newline":
          input.setEnterMode("newline")
          screen.setFlags({ autoApprove: autoApproved, retry429, enterMode: "newline" })
          screen.addTool("enter mode: newline")
          continue
        case "/clear": messages = []; historyCount = 0; screen.clearLogs(); screen.append(chalk.dim("History cleared.")); continue
        case "/exit":
        case "/quit": input.close(); process.stdout.write("\x1b[?1049l"); return
        case "/title": case "/info":
          screen.append(chalk.dim(`Messages: ${messages.length}, Session: ${SESSION_FILE}`))
          continue
        default:
          screen.append(chalk.dim(`Unknown command: ${trimmed}. Type /help`))
          continue
      }
    }

    screen.addUser(trimmed.split("\n")[0] ?? "")
    messages = await runSession(trimmed, messages, abort.signal, input, autoApproved, screen)
    saveSession(messages)
  }

  input.close()
  process.stdout.write("\x1b[?1049l")
}

async function runSession(
  userInput: string,
  history: Message[],
  abort: AbortSignal,
  input: InputController,
  autoApproved: boolean,
  screen: Screen,
): Promise<Message[]> {
  const retry429 = ["true", "1", "yes"].includes((process.env.OPENZEROCODE_RETRY_429 ?? "").toLowerCase())
  const retrySchedule = [2000, 5000, 10000]

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
    screen.setStatus("thinking...")
    const startTime = performance.now()
    const statusTimer = setInterval(() => {
      const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
      screen.setStatus(`thinking... ${elapsed}s`)
    }, 120)

    let stream: ReadableStream<any> | undefined
    let lastError: unknown
    for (let attempt = 0; attempt <= retrySchedule.length; attempt++) {
      stream = await runSync(
        Effect.gen(function* () {
          const p = yield* Provider
          return yield* p.stream({
            model: "big-pickle",
            messages: allMessages,
            tools: toolDefs.length > 0 ? toolDefs : undefined,
            stream: true,
          })
        }),
      ).catch((error) => {
        lastError = error
        return undefined
      })
      if (stream) break
      if (!retry429 || !isRateLimitError(lastError) || attempt >= retrySchedule.length) break
      const wait = retrySchedule[attempt]
      screen.setStatus(`rate limited, retry in ${Math.round(wait / 1000)}s...`)
      screen.addTool(`rate limited, retrying in ${Math.round(wait / 1000)}s`)
      await delay(wait)
    }

      if (!stream) {
        clearInterval(statusTimer)
        screen.setStatus("idle")
        screen.addTool("provider error")
      screen.append(screen.formatToolOutput(formatProviderError(lastError)))
        screen.append("")
        return resultHistory
      }
    if (!stream) return resultHistory

    const reader = stream.getReader()
    let collectedContent = ""
    let collectedReasoning = ""
    const accToolCalls = new Map<number, AccToolCall>()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      if (value.delta.reasoning_content) {
        collectedReasoning += value.delta.reasoning_content
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
        screen.setStatus(`reasoning... ${elapsed}s`)
      }
      if (value.delta.content) {
        collectedContent += value.delta.content
        const elapsed = ((performance.now() - startTime) / 1000).toFixed(1)
        screen.setStatus(`generating... ${elapsed}s`)
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

    const elapsedStr = ((performance.now() - startTime) / 1000).toFixed(1)
    clearInterval(statusTimer)
    screen.append(chalk.dim(`[${elapsedStr}s]`))

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

    // No tool calls → render markdown and return
    if (!toolCalls) {
      if (collectedContent) {
        const rendered = renderMarkdown(collectedContent)
        screen.addAssistant((rendered === collectedContent ? collectedContent : rendered).split("\n")[0] ?? "")
        screen.append(rendered === collectedContent ? collectedContent : rendered)
      }
      screen.append("")
      screen.setStatus("idle")
      return resultHistory
    }

    // Has tool calls → render any content, then execute
    if (collectedContent) {
      const rendered = renderMarkdown(collectedContent)
      screen.addAssistant((rendered === collectedContent ? collectedContent : rendered).split("\n")[0] ?? "")
      screen.append(rendered === collectedContent ? collectedContent : rendered)
    }
    screen.append("")

    // Execute tools
    for (const call of toolCalls) {
      const fnName = call.function.name ?? "unknown"
      const fnArgs = call.function.arguments ?? "{}"
      const args = tryParseJSON(fnArgs)
      const def = tools.find((t) => t.id === fnName)

      if (!def) {
        screen.append(screen.formatToolOutput(`✗ unknown tool: ${fnName}`))
        allMessages.push({ role: "tool", tool_call_id: call.id, content: `Unknown tool: ${fnName}` })
        continue
      }

      if (!autoApproved) {
        const ok = await input.readConfirm(`Allow ${fnName}?`)
        if (!ok) {
          screen.append(screen.formatToolOutput(`└ ${fnName} denied`))
          allMessages.push({ role: "tool", tool_call_id: call.id, content: "Permission denied" })
          continue
        }
      }

      screen.setStatus(`running tool: ${fnName}`)
      screen.addTool(`${fnName} pending`)
      screen.append(screen.formatToolOutput(`└ ${fnName} running...`))
      const t0 = performance.now()
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

      const elapsed = Math.round(performance.now() - t0)
      screen.addTool(`${fnName} complete ${elapsed}ms`)
      screen.append(screen.formatToolOutput(`✓ ${fnName} (${elapsed}ms)`))

      const text = convertToolResult(result)
      const preview = text.length < 300 ? text : text.slice(0, 300) + chalk.dim("...")
      screen.append(screen.formatToolOutput(preview))
      screen.append("")

      allMessages.push({ role: "tool", tool_call_id: call.id, content: text })
    }
    screen.setStatus("thinking...")
  }

  return resultHistory
}

main().catch((err) => {
  process.stdout.write("\x1b[?1049l")
  console.error(formatProviderError(err))
  process.exit(1)
})
