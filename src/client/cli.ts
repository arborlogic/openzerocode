import { Effect, Layer } from "effect"
import { bigPickleLayer } from "../provider/index"
import { layer as toolLayer } from "../tool/registry"
import { ToolRegistry } from "../tool/registry"
import { Provider } from "../provider/types"
import type { Message, ToolCall } from "../provider/types"
import { Context, Result } from "../tool/tool"
import { convertToolsToDefs, convertToolResult } from "../core/convert"
import * as readline from "readline"
import chalk from "chalk"
import { renderMarkdown } from "./markdown"
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

class Screen {
  private logs: string[] = []
  private status = "idle"
  private draft: string[] = []
  private cursorRow = 0
  private cursorCol = 0
  private scrollOffset = 0
  private inputRow = 0

  private statusBadge() {
    if (this.status.startsWith("thinking") || this.status.startsWith("reasoning") || this.status.startsWith("generating")) {
      return chalk.yellow("●")
    }
    if (this.status.startsWith("running tool")) return chalk.cyan("◆")
    if (this.status === "idle") return chalk.green("●")
    return chalk.dim("●")
  }

  private tone(text: string) {
    return chalk.hex("#A8B0BE")(text)
  }

  private panelLine(width: number, label: string) {
    const left = `┌ ${label} `
    const right = "┐"
    const fill = "─".repeat(Math.max(0, width - left.length - right.length))
    return `${left}${fill}${right}`
  }

  setStatus(status: string) {
    this.status = status
    this.render()
  }

  setCursor(row: number, col: number) {
    this.cursorRow = row
    this.cursorCol = col
    this.inputRow = row
    this.render()
  }

  private wrapLine(line: string, width: number) {
    if (width <= 0) return [line]
    if (line.length <= width) return [line]
    const chunks: string[] = []
    for (let i = 0; i < line.length; i += width) chunks.push(line.slice(i, i + width))
    return chunks
  }

  setDraft(lines: string[]) {
    this.draft = lines
    this.render()
  }

  append(text: string) {
    for (const line of text.split("\n")) this.logs.push(line)
    this.scrollOffset = 0
    this.render()
  }

  addUser(text: string) {
    this.append(`${chalk.bgHex("#1E2A1E").hex("#98C379")(" user ")} ${text}`)
  }

  addAssistant(text: string) {
    this.append(`${chalk.bgHex("#1A2430").hex("#61AFEF")(" assistant ")} ${text}`)
  }

  addTool(text: string) {
    this.append(`${chalk.bgHex("#2B1F31").hex("#C678DD")(" tool ")} ${text}`)
  }

  clearLogs() {
    this.logs = []
    this.scrollOffset = 0
    this.render()
  }

  scrollBy(delta: number) {
    const rows = process.stdout.rows || 30
    const responseHeight = Math.max(8, rows - 13)
    const maxOffset = Math.max(0, this.logs.length - responseHeight)
    this.scrollOffset = Math.max(0, Math.min(maxOffset, this.scrollOffset + delta))
    this.render()
  }

  render() {
    const cols = process.stdout.columns || 100
    const rows = process.stdout.rows || 30
    const responseHeight = Math.max(8, rows - 14)
    const end = this.logs.length - this.scrollOffset
    const start = Math.max(0, end - responseHeight)
    const response = this.logs.slice(start, end)
    const inputWidth = Math.max(12, cols - 10)
    const wrapped = this.draft.flatMap((line, idx) =>
      this.wrapLine(line, inputWidth).map((part, sub) => ({
        text: part,
        source: idx,
        cont: sub > 0,
      })),
    )
    const input = wrapped.slice(-4)
    const hr = "─".repeat(Math.max(10, cols - 4))
    const muted = "#7D8796"
    const bg = "#0F141B"
    const accent = "#61AFEF"
    const accent2 = "#98C379"
    const warn = "#E5C07B"
    const border = "#3B4252"
    const title = "#E6EDF3"
    const statusColor = this.status.startsWith("running tool")
      ? accent
      : this.status.startsWith("thinking") || this.status.startsWith("reasoning") || this.status.startsWith("generating")
        ? warn
        : accent2

    process.stdout.write("\x1b[2J\x1b[H")
    process.stdout.write(chalk.bgHex(bg).hex(title).bold(" OpenCode ") + " " + chalk.hex(muted)("session") + " " + chalk.hex(muted)(`model: ${process.env.OPENZERO_MODEL ?? "big-pickle"}`) + "\n")
    process.stdout.write(
      `${this.statusBadge()} ${chalk.hex(statusColor)(this.status)} ${chalk.hex(muted)(this.scrollOffset > 0 ? `• scrolled +${this.scrollOffset}` : "")}` +
        "\n",
    )
    process.stdout.write(chalk.hex(border)(this.panelLine(hr.length + 2, "Response")) + "\n")
    for (let i = 0; i < response.length; i++) {
      const rowBg = i % 2 === 0 ? "#101722" : "#0F141B"
      process.stdout.write(chalk.hex(border)("│") + chalk.bgHex(rowBg)(` ${response[i]}`) + "\n")
    }
    for (let i = response.length; i < responseHeight; i++) process.stdout.write(chalk.hex(border)("│") + "\n")
    process.stdout.write(chalk.hex(border)(`└${hr}┘`) + "\n")
    process.stdout.write(chalk.hex(border)(this.panelLine(hr.length + 2, "Input")) + "\n")
    if (input.length === 0) process.stdout.write(chalk.hex(border)("│ ") + chalk.hex(accent)("> ") + chalk.hex(muted)("Ask anything. Empty line to submit") + "\n")
    for (const line of input) {
      const isActive = line.source === this.inputRow
      const prefix = line.cont ? "  " : "> "
      const text = isActive ? chalk.hex(title).bold(line.text) : chalk.hex("#C9D1D9")(line.text)
      process.stdout.write(chalk.hex(border)("│ ") + chalk.hex(accent)(prefix) + text + "\n")
    }
    for (let i = input.length; i < 4; i++) process.stdout.write(chalk.hex(border)("│") + "\n")
    process.stdout.write(chalk.hex(border)(`└${hr}┘`) + "\n")
    process.stdout.write(
      chalk.hex(muted)(`L${this.cursorRow + 1}:C${this.cursorCol + 1}`) +
        "  " +
        chalk.hex(accent)("/help") +
        chalk.hex(muted)(" ") +
        chalk.hex(accent)("/clear") +
        chalk.hex(muted)(" ") +
        chalk.hex(accent)("/info") +
        chalk.hex(muted)(" ") +
        chalk.hex(accent)("/exit") +
        chalk.hex(muted)("  •  scroll PgUp/PgDn  •  submit: empty line") +
        "\n",
    )
  }
}

class InputController {
  private queue: Array<(v: string) => void> = []
  private mode: "idle" | "prompt" | "confirm" = "idle"
  private lines = [""]
  private row = 0
  private col = 0
  private confirm = ""
  private confirmResolve: ((v: string) => void) | undefined

  constructor(private screen: Screen, private abort: AbortController) {
    readline.emitKeypressEvents(process.stdin)
    if (process.stdin.isTTY) process.stdin.setRawMode(true)
    process.stdin.on("keypress", (str, key) => this.onKey(str, key))
  }

  close() {
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
  }

  readPrompt(): Promise<string> {
    this.mode = "prompt"
    this.lines = [""]
    this.row = 0
    this.col = 0
    this.screen.setDraft(this.lines)
    this.screen.setCursor(0, 0)
    return new Promise((resolve) => this.queue.push(resolve))
  }

  readConfirm(label: string): Promise<boolean> {
    this.mode = "confirm"
    this.confirm = label
    this.screen.setStatus(`${label} [Y/n]`)
    return new Promise((resolve) => {
      this.confirmResolve = (v) => resolve(v === "" || v === "y" || v === "yes")
    })
  }

  private submitPrompt() {
    if (this.queue.length === 0) return
    const value = this.lines.join("\n")
    const next = this.queue.shift()
    this.mode = "idle"
    this.screen.setDraft([])
    next?.(value)
  }

  private onKey(str: string, key: readline.Key) {
    if (key.ctrl && key.name === "c") {
      this.abort.abort()
      return
    }
    if (this.mode === "confirm") {
      if (key.name !== "return") {
        if (key.name === "backspace") return
        if (str) this.confirm += str
        return
      }
      const value = this.confirm.trim().toLowerCase().replace(/^.+\[y\/n\]\s*/i, "")
      const resolve = this.confirmResolve
      this.confirmResolve = undefined
      this.confirm = ""
      this.mode = "idle"
      resolve?.(value)
      return
    }
    if (this.mode !== "prompt") return

    const line = this.lines[this.row]
    if (key.name === "return") {
      const total = this.lines.join("\n").trim()
      if (line.length === 0 && total.length > 0) {
        this.submitPrompt()
        return
      }
      const head = line.slice(0, this.col)
      const tail = line.slice(this.col)
      this.lines[this.row] = head
      this.lines.splice(this.row + 1, 0, tail)
      this.row++
      this.col = 0
      this.screen.setDraft(this.lines)
      this.screen.setCursor(this.row, this.col)
      return
    }
    if (key.ctrl && key.name === "d") {
      if (this.lines.join("\n").trim().length === 0) {
        this.abort.abort()
        return
      }
      this.submitPrompt()
      return
    }
    if (key.name === "backspace") {
      if (this.col > 0) {
        this.lines[this.row] = line.slice(0, this.col - 1) + line.slice(this.col)
        this.col--
      } else if (this.row > 0) {
        const prev = this.lines[this.row - 1]
        this.col = prev.length
        this.lines[this.row - 1] = prev + line
        this.lines.splice(this.row, 1)
        this.row--
      }
      this.screen.setDraft(this.lines)
      this.screen.setCursor(this.row, this.col)
      return
    }
    if (key.name === "left") {
      if (this.col > 0) this.col--
      else if (this.row > 0) {
        this.row--
        this.col = this.lines[this.row].length
      }
      this.screen.setCursor(this.row, this.col)
      return
    }
    if (key.name === "right") {
      if (this.col < line.length) this.col++
      else if (this.row < this.lines.length - 1) {
        this.row++
        this.col = 0
      }
      this.screen.setCursor(this.row, this.col)
      return
    }
    if (key.name === "up") {
      if (this.row > 0) {
        this.row--
        this.col = Math.min(this.col, this.lines[this.row].length)
      }
      this.screen.setCursor(this.row, this.col)
      return
    }
    if (key.name === "down") {
      if (this.row < this.lines.length - 1) {
        this.row++
        this.col = Math.min(this.col, this.lines[this.row].length)
      }
      this.screen.setCursor(this.row, this.col)
      return
    }
    if (key.name === "pageup" || (key.ctrl && key.name === "b")) {
      this.screen.scrollBy(8)
      return
    }
    if (key.name === "pagedown" || (key.ctrl && key.name === "f")) {
      this.screen.scrollBy(-8)
      return
    }
    if (!str || key.meta || key.ctrl) return
    this.lines[this.row] = line.slice(0, this.col) + str + line.slice(this.col)
    this.col += str.length
    this.screen.setDraft(this.lines)
    this.screen.setCursor(this.row, this.col)
  }
}

function runSync<E, A>(effect: Effect.Effect<A, E, ToolRegistry | Provider>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(appLayer)))
}

function tryParseJSON(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) } catch { return {} }
}

function formatProviderError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (text.includes("429") || text.includes("Rate limit exceeded") || text.includes("FreeUsageLimitError")) {
    return "Provider rate limit reached (free tier). Please wait a bit and try again, or switch to another provider/model."
  }
  if (text.includes("401") || text.includes("AuthError") || text.includes("Invalid API key")) {
    return "Provider authentication failed. Check OPENCODE_API_KEY."
  }
  if (text.includes("fetch failed") || text.includes("SSL") || text.includes("socket")) {
    return "Network error while contacting provider. Please retry."
  }
  return `Provider error: ${text}`
}

function isRateLimitError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return text.includes("429") || text.includes("Rate limit exceeded") || text.includes("FreeUsageLimitError")
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function printHelp() {
  console.log("\nCommands:")
  console.log(`  /help  Show this help`)
  console.log(`  /clear Clear conversation history`)
  console.log(`  /info  Show current session info`)
  console.log(`  /exit  Exit the program`)
  console.log("Input:")
  console.log("  Multi-line input is enabled. Submit with an empty line.")
}

async function main() {
  const abort = new AbortController()
  const screen = new Screen()
  const input = new InputController(screen, abort)
  process.stdout.write("\x1b[?1049h")
  process.stdin.on("end", () => abort.abort())

  let messages: Message[] = loadSession()
  let historyCount = messages.length

  const autoApprove = ["true", "1", "yes"].includes((process.env.OPENZEROCODE_AUTO_APPROVE ?? "").toLowerCase())
  let autoApproved = false
  if (autoApprove) {
    autoApproved = await input.readConfirm("Auto-approve all tool calls?")
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
        case "/help": printHelp(); screen.append(chalk.dim("Use empty line to submit multi-line prompt.")); continue
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
      screen.append(chalk.red(formatProviderError(lastError)))
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
        screen.append(chalk.red(`  ✗ unknown tool: ${fnName}`))
        allMessages.push({ role: "tool", tool_call_id: call.id, content: `Unknown tool: ${fnName}` })
        continue
      }

      if (!autoApproved) {
        const ok = await input.readConfirm(`Allow ${fnName}?`)
        if (!ok) {
          screen.append(chalk.dim(`  └ ${fnName} ${chalk.red("denied")}`))
          allMessages.push({ role: "tool", tool_call_id: call.id, content: "Permission denied" })
          continue
        }
      }

      screen.setStatus(`running tool: ${fnName}`)
      screen.addTool(`${fnName} pending`)
      screen.append(`  └ ${chalk.bold(fnName)} ${chalk.dim("running...")}`)
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
      screen.append(`    ${chalk.green("✓")} ${chalk.dim(`(${elapsed}ms)`)}`)

      const text = convertToolResult(result)
      const preview = text.length < 300 ? text : text.slice(0, 300) + chalk.dim("...")
      screen.append(chalk.dim(`    ${preview}`))
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
