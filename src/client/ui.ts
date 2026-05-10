import chalk from "chalk"
import * as readline from "readline"
import { buildPalette, commandItems, completeCommand, shouldSubmitByEnter } from "./palette"

export class Screen {
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
    if (this.status.startsWith("thinking") || this.status.startsWith("reasoning") || this.status.startsWith("generating")) return chalk.yellow("●")
    if (this.status.startsWith("running tool")) return chalk.cyan("◆")
    if (this.status === "idle") return chalk.green("●")
    return chalk.dim("●")
  }

  private panelLine(width: number, label: string) {
    const left = `┌ ${label} `
    const right = "┐"
    return `${left}${"─".repeat(Math.max(0, width - left.length - right.length))}${right}`
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
    if (width <= 0 || line.length <= width) return [line]
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

  addUser(text: string) { this.appendRole("user", text) }
  addAssistant(text: string) { this.appendRole("assistant", text) }
  addTool(text: string) { this.appendRole("tool", text) }

  private stamp() {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
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
    const response = this.logs.slice(Math.max(0, end - responseHeight), end)
    const inputWidth = Math.max(12, cols - 10)
    const input = this.draft.flatMap((line, idx) =>
      this.wrapLine(line, inputWidth).map((part, sub) => ({ text: part, source: idx, cont: sub > 0, start: sub * inputWidth, end: sub * inputWidth + part.length })),
    ).slice(-4)

    const hr = "─".repeat(Math.max(10, cols - 4))
    const muted = "#7D8796"
    const accent = "#61AFEF"
    const statusColor = this.status.startsWith("running tool") ? accent : this.status.startsWith("thinking") || this.status.startsWith("reasoning") || this.status.startsWith("generating") ? "#E5C07B" : "#98C379"
    const border = "#3B4252"
    const title = "#E6EDF3"

    process.stdout.write("\x1b[2J\x1b[H")
    process.stdout.write(chalk.bgHex("#0F141B").hex(title).bold(" OpenCode ") + " " + chalk.hex(muted)("session") + " " + chalk.hex(muted)(`model: ${process.env.OPENZERO_MODEL ?? "big-pickle"}`) + "\n")
    process.stdout.write(`${this.statusBadge()} ${chalk.hex(statusColor)(this.status)} ${chalk.hex(muted)(this.scrollOffset > 0 ? `• scrolled +${this.scrollOffset}` : "")}\n`)
    process.stdout.write(chalk.hex(border)(this.panelLine(hr.length + 2, "Response")) + "\n")
    for (let i = 0; i < response.length; i++) {
      const rowBg = i % 2 === 0 ? "#101722" : "#0F141B"
      process.stdout.write(chalk.hex(border)("│") + chalk.bgHex(rowBg)(` ${this.fitLine(response[i] ?? "", cols - 6)}`) + "\n")
    }
    for (let i = response.length; i < responseHeight; i++) process.stdout.write(chalk.hex(border)("│") + "\n")
    process.stdout.write(chalk.hex(border)(`└${hr}┘`) + "\n")
    process.stdout.write(chalk.hex(muted)(`latest: ${this.latestStatusLine || "idle"}`) + "\n")
    process.stdout.write(chalk.hex(border)(this.panelLine(hr.length + 2, "Input")) + "\n")
    if (input.length === 0) process.stdout.write(chalk.hex(border)("│ ") + chalk.hex(accent)("> ") + chalk.hex(muted)("Ask anything. Enter to submit") + "\n")
    for (const line of input) {
      const active = line.source === this.inputRow
      let shown = line.text
      if (active && this.cursorCol >= line.start && this.cursorCol <= line.end) shown = line.text.slice(0, this.cursorCol - line.start) + "▌" + line.text.slice(this.cursorCol - line.start)
      const text = active ? chalk.hex(title).bold(shown) : chalk.hex("#C9D1D9")(shown)
      process.stdout.write(chalk.hex(border)("│ ") + chalk.hex(accent)(line.cont ? "  " : "> ") + text + "\n")
    }
    for (let i = input.length; i < 4; i++) process.stdout.write(chalk.hex(border)("│") + "\n")
    process.stdout.write(chalk.hex(border)(`└${hr}┘`) + "\n")
    process.stdout.write(chalk.hex(muted)(`L${this.cursorRow + 1}:C${this.cursorCol + 1}`) + "  " + chalk.hex(accent)("/help") + chalk.hex(muted)(" ") + chalk.hex(accent)("/clear") + chalk.hex(muted)(" ") + chalk.hex(accent)("/info") + chalk.hex(muted)(" ") + chalk.hex(accent)("/exit") + chalk.hex(muted)(`  •  enter:${this.enterMode}  •  scroll PgUp/PgDn  •  auto:${this.autoApprove ? "on" : "off"} retry429:${this.retry429 ? "on" : "off"}`) + "\n")
    process.stdout.write(chalk.hex("#667085")("keys: ↑↓ move  ←→ cursor  Enter/Ctrl+Enter/Ctrl+N based on mode  PgUp/PgDn scroll") + "\n")

    if (this.palette.open) {
      const popupWidth = Math.max(48, Math.min(96, cols - 12))
      const popupHeight = Math.max(10, Math.min(16, rows - 10))
      const left = Math.max(2, Math.floor((cols - popupWidth) / 2))
      const top = Math.max(4, Math.floor((rows - popupHeight) / 2))
      const titleLine = `${this.palette.title}${this.palette.query ? `  query: ${this.palette.query}` : ""}`
      const bodyHeight = popupHeight - 3
      const maxStart = Math.max(0, this.palette.items.length - bodyHeight)
      const start = Math.max(0, Math.min(maxStart, this.palette.selected - Math.floor(bodyHeight / 2)))
      const body = this.palette.items.slice(start, start + bodyHeight)
      const modeBadge = this.palette.title.toLowerCase().includes("slash")
        ? chalk.bgHex("#1E3A8A").hex("#DBEAFE")(" Slash ")
        : chalk.bgHex("#14532D").hex("#DCFCE7")(" Ctrl+P ")

      for (let y = 3; y < rows - 2; y++) {
        process.stdout.write(`\x1b[${y};2H`)
        process.stdout.write(chalk.hex("#111827")("·".repeat(Math.max(0, cols - 3))))
      }

      process.stdout.write(`\x1b[${top};${left}H`)
      process.stdout.write(chalk.hex("#5B6475")(`┌ ${this.fitLine(titleLine, popupWidth - 16)} ${modeBadge} ${"─".repeat(Math.max(0, popupWidth - Math.min(popupWidth - 16, titleLine.length) - 12))}┐`))
      for (let i = 0; i < popupHeight - 2; i++) {
        process.stdout.write(`\x1b[${top + 1 + i};${left}H`)
        const item = body[i]
        if (!item) {
          process.stdout.write(chalk.hex("#5B6475")("│") + chalk.bgHex("#111827")(" ".repeat(popupWidth - 2)) + chalk.hex("#5B6475")("│"))
          continue
        }
        const header = item.startsWith("[ ")
        const active = start + i === this.palette.selected
        const plain = this.fitLine(item, popupWidth - 4)
        const rendered = header
          ? chalk.bgHex("#111827").hex(muted).bold(`  ${plain}`)
          : active
            ? chalk.bgHex("#1E293B").hex("#F8FAFC")(`› ${this.fitLine(item, popupWidth - 5)}`)
            : chalk.bgHex("#111827").hex("#A8B0BE")(`  ${plain}`)
        const pad = " ".repeat(Math.max(0, popupWidth - 3 - plain.length))
        process.stdout.write(chalk.hex("#5B6475")("│") + rendered + chalk.bgHex("#111827")(pad) + chalk.hex("#5B6475")("│"))
      }
      process.stdout.write(`\x1b[${top + popupHeight - 1};${left}H`)
      process.stdout.write(chalk.hex("#5B6475")(`└${"─".repeat(popupWidth - 2)}┘`))
      process.stdout.write(`\x1b[${top + popupHeight};${left}H`)
      const range = `${start + 1}-${Math.min(start + body.length, this.palette.items.length)} / ${this.palette.items.length}`
      process.stdout.write(chalk.hex("#94A3B8")(`↑↓ select  Enter apply  Tab complete  Esc close  •  ${range}`))
    }
  }

  formatToolOutput(text: string) {
    const lower = text.toLowerCase()
    if (lower.includes("error") || lower.includes("failed") || lower.includes("denied")) return chalk.hex("#E06C75")(text)
    if (lower.includes("warning") || lower.includes("warn") || lower.includes("rate limit")) return chalk.hex("#E5C07B")(text)
    return chalk.hex("#98C379")(text)
  }
}

export class InputController {
  private queue: Array<(v: string) => void> = []
  private mode: "idle" | "prompt" | "confirm" = "idle"
  private lines = [""]
  private row = 0
  private col = 0
  private confirm = ""
  private confirmResolve: ((v: string) => void) | undefined
  private paletteOpen = false
  private paletteTitle = ""
  private paletteItems: string[] = []
  private paletteSelected = 0
  private paletteQuery = ""
  private commands = commandItems
  private recent: string[] = []
  private paletteFiltered: Array<{ group: string; cmd: string; desc: string }> = []
  private paletteCommandSelected = 0

  constructor(private screen: Screen, private abort: AbortController, private enterMode: "submit" | "newline") {
    readline.emitKeypressEvents(process.stdin)
    if (process.stdin.isTTY) process.stdin.setRawMode(true)
    process.stdin.on("keypress", (str, key) => this.onKey(str, key))
  }

  close() { if (process.stdin.isTTY) process.stdin.setRawMode(false) }
  setEnterMode(mode: "submit" | "newline") { this.enterMode = mode }
  getEnterMode() { return this.enterMode }

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
    return new Promise((resolve) => { this.confirmResolve = (v) => resolve(v === "" || v === "y" || v === "yes") })
  }

  private submitPrompt() {
    if (this.queue.length === 0) return
    const next = this.queue.shift()
    const value = this.lines.join("\n")
    this.mode = "idle"
    this.closePalette()
    this.screen.setDraft([])
    next?.(value)
  }

  private updatePalette() {
    const built = buildPalette({
      query: this.paletteQuery,
      selected: this.paletteCommandSelected,
      recent: this.recent,
      commands: this.commands,
    })
    this.paletteFiltered = built.filtered
    this.paletteCommandSelected = built.commandSelected
    this.screen.setPalette({ open: this.paletteOpen, title: this.paletteTitle, items: built.items, selected: built.selectedDisplay, query: this.paletteQuery })
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
    if (key.ctrl && key.name === "c") return void this.abort.abort()
    if (this.mode === "confirm") {
      if (key.name !== "return") {
        if (key.name !== "backspace" && str) this.confirm += str
        return
      }
      const resolve = this.confirmResolve
      this.confirmResolve = undefined
      const value = this.confirm.trim().toLowerCase().replace(/^.+\[y\/n\]\s*/i, "")
      this.confirm = ""
      this.mode = "idle"
      return void resolve?.(value)
    }
    if (this.mode !== "prompt") return

    if (key.ctrl && key.name === "p") {
      this.paletteOpen = true
      this.paletteTitle = "Command Palette"
      this.paletteSelected = 0
      this.paletteCommandSelected = 0
      this.paletteQuery = ""
      this.updatePalette()
      return
    }
    if (key.name === "escape") return void this.closePalette()
    if (this.paletteOpen) {
      if (key.name === "up") { this.paletteCommandSelected = Math.max(0, this.paletteCommandSelected - 1); return void this.updatePalette() }
      if (key.name === "down") { this.paletteCommandSelected++; return void this.updatePalette() }
      if (key.name === "backspace") { this.paletteQuery = this.paletteQuery.slice(0, -1); return void this.updatePalette() }
      if (key.name === "return") {
        const pick = this.paletteFiltered[this.paletteCommandSelected]
        if (!pick) return void this.closePalette()
        this.lines = [pick.cmd]
        this.row = 0
        this.col = pick.cmd.length
        this.screen.setDraft(this.lines)
        this.screen.setCursor(this.row, this.col)
        this.recent = [pick.cmd, ...this.recent.filter((x) => x !== pick.cmd)].slice(0, 8)
        this.closePalette()
        this.submitPrompt()
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
      const shouldSubmit = shouldSubmitByEnter({ enterMode: this.enterMode, ctrl: !!key.ctrl, hasContent: total.length > 0 })
      const submitByEnter = this.enterMode === "submit" && !key.ctrl
      const submitByCtrlEnter = this.enterMode === "newline" && key.ctrl
      if (shouldSubmit) return void this.submitPrompt()
      if (submitByEnter || submitByCtrlEnter) return void (this.screen.setDraft(this.lines), this.screen.setCursor(this.row, this.col))
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
      if (this.lines.join("\n").trim().length > 0) this.submitPrompt()
      return
    }
    if (key.ctrl && key.name === "m") {
      if (this.lines.join("\n").trim().length > 0) return void this.submitPrompt()
      this.screen.setDraft(this.lines)
      this.screen.setCursor(this.row, this.col)
      return
    }
    if (key.ctrl && key.name === "d") {
      if (this.lines.join("\n").trim().length === 0) return void this.abort.abort()
      return void this.submitPrompt()
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
      else if (this.row > 0) { this.row--; this.col = this.lines[this.row].length }
      this.screen.setCursor(this.row, this.col)
      return
    }
    if (key.name === "right") {
      if (this.col < line.length) this.col++
      else if (this.row < this.lines.length - 1) { this.row++; this.col = 0 }
      this.screen.setCursor(this.row, this.col)
      return
    }
    if (key.name === "up") {
      if (this.row > 0) { this.row--; this.col = Math.min(this.col, this.lines[this.row].length) }
      this.screen.setCursor(this.row, this.col)
      return
    }
    if (key.name === "down") {
      if (this.row < this.lines.length - 1) { this.row++; this.col = Math.min(this.col, this.lines[this.row].length) }
      this.screen.setCursor(this.row, this.col)
      return
    }
    if (key.name === "pageup" || (key.ctrl && key.name === "b")) return void this.screen.scrollBy(8)
    if (key.name === "pagedown" || (key.ctrl && key.name === "f")) return void this.screen.scrollBy(-8)
    if (!str || key.meta || key.ctrl) return

    this.lines[this.row] = line.slice(0, this.col) + str + line.slice(this.col)
    this.col += str.length
    this.screen.setDraft(this.lines)
    this.screen.setCursor(this.row, this.col)
    if (key.name === "tab" && this.row === 0 && this.lines[0]?.startsWith("/")) {
      const query = this.lines[0]
      const cmd = completeCommand(query, this.commands)
      if (cmd) {
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
      this.paletteQuery = this.lines[0]
      this.paletteSelected = 0
      this.paletteCommandSelected = 0
      this.updatePalette()
      return
    }
    if (this.paletteOpen) this.closePalette()
  }
}
