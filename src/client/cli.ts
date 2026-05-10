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
  private autoApprove = false
  private retry429 = false
  private enterMode: "submit" | "newline" = "submit"
  private lastRole: "user" | "assistant" | "tool" | undefined
  private latestStatusLine = ""
  private palette: { open: boolean; title: string; items: string[]; selected: number; query: string } = {
    open: false,
    title: "",
    items: [],
    selected: 0,
    query: "",
  }

  private fitLine(text: string, width: number) {
    if (width <= 4) return text
    if (text.length <= width) return text
    return text.slice(0, Math.max(0, width - 1)) + "…"
  }

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
    this.latestStatusLine = status
    this.render()
  }

  setCursor(row: number, col: number) {
    this.cursorRow = row
    this.cursorCol = col
    this.inputRow = row
    this.render()
  }

  setFlags(flags: { autoApprove: boolean; retry429: boolean; enterMode: "submit" | "newline" }) {
    this.autoApprove = flags.autoApprove
    this.retry429 = flags.retry429
    this.enterMode = flags.enterMode
    this.render()
  }

  setPalette(palette: { open: boolean; title: string; items: string[]; selected: number; query: string }) {
    this.palette = palette
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
    this.appendRole("user", text)
  }

  addAssistant(text: string) {
    this.appendRole("assistant", text)
  }

  addTool(text: string) {
    this.appendRole("tool", text)
  }

  private stamp() {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, "0")
    const mm = String(now.getMinutes()).padStart(2, "0")
    return `${hh}:${mm}`
  }

  private appendRole(role: "user" | "assistant" | "tool", text: string) {
    const label = role === "user"
      ? chalk.bgHex("#1E2A1E").hex("#98C379")(" user ")
      : role === "assistant"
        ? chalk.bgHex("#1A2430").hex("#61AFEF")(" assistant ")
        : chalk.bgHex("#2B1F31").hex("#C678DD")(" tool ")
    const lines = text.split("\n")
    const time = chalk.hex("#7D8796")(`[${this.stamp()}]`)
    const accent = role === "assistant" ? chalk.hex("#61AFEF")("▎") : role === "tool" ? chalk.hex("#C678DD")("▎") : " "
    if (this.lastRole === role) {
      for (const line of lines) this.logs.push(`${accent} ${line}`)
      this.scrollOffset = 0
      this.render()
      return
    }
    if (this.logs.length > 0) this.logs.push("")
    this.lastRole = role
    this.logs.push(`${label} ${time} ${lines[0] ?? ""}`)
    for (let i = 1; i < lines.length; i++) this.logs.push(`${accent} ${lines[i]}`)
    this.scrollOffset = 0
    this.render()
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
        start: sub * inputWidth,
        end: sub * inputWidth + part.length,
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
      const line = this.fitLine(response[i] ?? "", cols - 6)
      process.stdout.write(chalk.hex(border)("│") + chalk.bgHex(rowBg)(` ${line}`) + "\n")
    }
    for (let i = response.length; i < responseHeight; i++) process.stdout.write(chalk.hex(border)("│") + "\n")
    process.stdout.write(chalk.hex(border)(`└${hr}┘`) + "\n")
    process.stdout.write(chalk.hex("#7D8796")(`latest: ${this.latestStatusLine || "idle"}`) + "\n")
    process.stdout.write(chalk.hex(border)(this.panelLine(hr.length + 2, "Input")) + "\n")
    if (input.length === 0) process.stdout.write(chalk.hex(border)("│ ") + chalk.hex(accent)("> ") + chalk.hex(muted)("Ask anything. Enter to submit") + "\n")
    for (const line of input) {
      const isActive = line.source === this.inputRow
      const prefix = line.cont ? "  " : "> "
      let shown = line.text
      if (isActive && this.cursorCol >= line.start && this.cursorCol <= line.end) {
        const local = this.cursorCol - line.start
        shown = line.text.slice(0, local) + "▌" + line.text.slice(local)
      }
      const text = isActive ? chalk.hex(title).bold(shown) : chalk.hex("#C9D1D9")(shown)
      process.stdout.write(chalk.hex(border)("│ ") + chalk.hex(accent)(prefix) + text + "\n")
    }
    for (let i = input.length; i < 4; i++) process.stdout.write(chalk.hex(border)("│") + "\n")
    process.stdout.write(chalk.hex(border)(`└${hr}┘`) + "\n")
    if (this.palette.open) {
      const titleLine = `${this.palette.title}${this.palette.query ? `  query: ${this.palette.query}` : ""}`
      process.stdout.write(chalk.hex("#3B4252")(`┌ ${titleLine} ${"─".repeat(Math.max(0, cols - titleLine.length - 6))}┐`) + "\n")
      const shown = this.palette.items.slice(0, 6)
      for (let i = 0; i < shown.length; i++) {
        const active = i === this.palette.selected
        const header = shown[i]?.startsWith("[ ")
        const line = header
          ? chalk.hex("#7D8796").bold(`  ${shown[i]}`)
          : active
            ? chalk.bgHex("#1F2937").hex("#E5E7EB")(`› ${shown[i]}`)
            : chalk.hex("#A8B0BE")(`  ${shown[i]}`)
        process.stdout.write(chalk.hex("#3B4252")("│") + ` ${this.fitLine(line, cols - 6)}` + "\n")
      }
      for (let i = shown.length; i < 6; i++) process.stdout.write(chalk.hex("#3B4252")("│") + "\n")
      process.stdout.write(chalk.hex("#3B4252")(`└${"─".repeat(Math.max(10, cols - 4))}┘`) + "\n")
      process.stdout.write(chalk.hex("#667085")("palette: ↑↓ select  Enter apply  Tab complete  Esc close") + "\n")
    }
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
        chalk.hex(muted)(`  •  enter:${this.enterMode}  •  scroll PgUp/PgDn  •  auto:${this.autoApprove ? "on" : "off"} retry429:${this.retry429 ? "on" : "off"}`) +
        "\n",
    )
    process.stdout.write(chalk.hex("#667085")("keys: ↑↓ move  ←→ cursor  Enter/Ctrl+Enter/Ctrl+N based on mode  PgUp/PgDn scroll") + "\n")
  }

  formatToolOutput(text: string) {
    const lower = text.toLowerCase()
    if (lower.includes("error") || lower.includes("failed") || lower.includes("denied")) return chalk.hex("#E06C75")(text)
    if (lower.includes("warning") || lower.includes("warn") || lower.includes("rate limit")) return chalk.hex("#E5C07B")(text)
    return chalk.hex("#98C379")(text)
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
  private enterMode: "submit" | "newline"
  private paletteOpen = false
  private paletteTitle = ""
  private paletteItems: string[] = []
  private paletteSelected = 0
  private paletteQuery = ""
  private commands = [
    { group: "Session", cmd: "/help", desc: "show help" },
    { group: "Session", cmd: "/clear", desc: "clear conversation history" },
    { group: "Session", cmd: "/info", desc: "show session info" },
    { group: "Input", cmd: "/enter submit", desc: "Enter submits, Ctrl+N newline" },
    { group: "Input", cmd: "/enter newline", desc: "Enter newline, Ctrl+Enter submit" },
    { group: "App", cmd: "/exit", desc: "exit program" },
  ]
  private recent: string[] = []
  private paletteFiltered: Array<{ group: string; cmd: string; desc: string }> = []
  private paletteDisplayMap: number[] = []
  private paletteCommandSelected = 0

  constructor(private screen: Screen, private abort: AbortController, enterMode: "submit" | "newline") {
    this.enterMode = enterMode
    readline.emitKeypressEvents(process.stdin)
    if (process.stdin.isTTY) process.stdin.setRawMode(true)
    process.stdin.on("keypress", (str, key) => this.onKey(str, key))
  }

  close() {
    if (process.stdin.isTTY) process.stdin.setRawMode(false)
  }

  setEnterMode(mode: "submit" | "newline") {
    this.enterMode = mode
  }

  getEnterMode() {
    return this.enterMode
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
    this.closePalette()
    this.screen.setDraft([])
    next?.(value)
  }

  private updatePalette() {
    const query = this.paletteQuery.toLowerCase()
    const source = this.commands
      .filter((x) => `${x.cmd} ${x.desc}`.toLowerCase().includes(query))
      .toSorted((a, b) => {
        const ai = this.recent.indexOf(a.cmd)
        const bi = this.recent.indexOf(b.cmd)
        if (ai === -1 && bi === -1) return 0
        if (ai === -1) return 1
        if (bi === -1) return -1
        return ai - bi
      })
    this.paletteFiltered = source
    this.paletteCommandSelected = Math.max(0, Math.min(this.paletteCommandSelected, Math.max(0, source.length - 1)))

    const groups = ["Session", "Input", "App"]
    const items: string[] = []
    const map: number[] = []
    let selectedDisplay = 0
    for (const group of groups) {
      const inGroup = source
        .map((x, idx) => ({ x, idx }))
        .filter((v) => v.x.group === group)
      if (inGroup.length === 0) continue
      items.push(`[ ${group} ]`)
      map.push(-1)
      for (const v of inGroup) {
        if (v.idx === this.paletteCommandSelected) selectedDisplay = items.length
        items.push(`${v.x.cmd}  —  ${v.x.desc}`)
        map.push(v.idx)
      }
    }
    this.paletteDisplayMap = map
    this.screen.setPalette({
      open: this.paletteOpen,
      title: this.paletteTitle,
      items,
      selected: selectedDisplay,
      query: this.paletteQuery,
    })
  }

  private closePalette() {
    this.paletteOpen = false
    this.paletteTitle = ""
    this.paletteItems = []
    this.paletteSelected = 0
    this.paletteQuery = ""
    this.screen.setPalette({ open: false, title: "", items: [], selected: 0, query: "" })
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

    if (key.ctrl && key.name === "p") {
      this.paletteOpen = true
      this.paletteTitle = "Command Palette"
      this.paletteItems = []
      this.paletteSelected = 0
      this.paletteCommandSelected = 0
      this.paletteQuery = ""
      this.updatePalette()
      return
    }
    if (key.name === "escape") {
      this.closePalette()
      return
    }
    if (this.paletteOpen) {
      if (key.name === "up") {
        this.paletteCommandSelected = Math.max(0, this.paletteCommandSelected - 1)
        this.updatePalette()
        return
      }
      if (key.name === "down") {
        this.paletteCommandSelected = this.paletteCommandSelected + 1
        this.updatePalette()
        return
      }
      if (key.name === "backspace") {
        this.paletteQuery = this.paletteQuery.slice(0, -1)
        this.updatePalette()
        return
      }
      if (key.name === "return") {
        const pick = this.paletteFiltered[this.paletteCommandSelected]
        if (pick) {
          const cmd = pick.cmd
          this.lines = [cmd]
          this.row = 0
          this.col = cmd.length
          this.screen.setDraft(this.lines)
          this.screen.setCursor(this.row, this.col)
          this.recent = [cmd, ...this.recent.filter((x) => x !== cmd)].slice(0, 8)
          this.closePalette()
          this.submitPrompt()
          return
        }
        this.closePalette()
        return
      }
      if (str && !key.ctrl && !key.meta && str >= " ") {
        this.paletteQuery += str
        this.paletteCommandSelected = 0
        this.updatePalette()
        return
      }
    }

    const line = this.lines[this.row]
    if (key.name === "return") {
      const total = this.lines.join("\n").trim()
      const submitByEnter = this.enterMode === "submit" && !key.ctrl
      const submitByCtrlEnter = this.enterMode === "newline" && key.ctrl
      if ((submitByEnter || submitByCtrlEnter) && total.length > 0) {
        this.submitPrompt()
        return
      }
      if (submitByEnter || submitByCtrlEnter) {
        this.screen.setDraft(this.lines)
        this.screen.setCursor(this.row, this.col)
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
      if (this.row === 0 && this.lines[0]?.startsWith("/")) {
        this.paletteOpen = true
        this.paletteTitle = "Slash Commands"
        this.paletteItems = []
        this.paletteQuery = this.lines[0]
        this.paletteSelected = 0
        this.paletteCommandSelected = 0
        this.updatePalette()
      }
      return
    }
    if (key.ctrl && key.name === "n") {
      if (this.enterMode === "submit") {
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
      if (this.lines.join("\n").trim().length > 0) {
        this.submitPrompt()
      }
      return
    }
    if (key.ctrl && key.name === "m") {
      const total = this.lines.join("\n").trim()
      if (total.length > 0) {
        this.submitPrompt()
        return
      }
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
    if (key.name === "tab" && this.row === 0 && this.lines[0]?.startsWith("/")) {
      const query = this.lines[0]
      const matches = this.commands.filter((x) => x.cmd.startsWith(query))
      if (matches.length === 1) {
        const cmd = matches[0]?.cmd ?? query
        this.lines[0] = cmd
        this.col = cmd.length
        this.screen.setDraft(this.lines)
        this.screen.setCursor(this.row, this.col)
        return
      }
    }
    if (this.row === 0 && this.lines[0]?.startsWith("/")) {
      this.paletteOpen = true
      this.paletteTitle = "Slash Commands"
      this.paletteItems = []
      this.paletteQuery = this.lines[0]
      this.paletteSelected = 0
      this.paletteCommandSelected = 0
      this.updatePalette()
      return
    }
    if (this.paletteOpen) this.closePalette()
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
