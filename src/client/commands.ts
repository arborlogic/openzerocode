import type { Setter } from "solid-js"
import type { DisplayBlock } from "./tui"
import { saveSession } from "./session-state"
import type { Message } from "../provider/types"

export type SlashCommandDef = {
  name: string
  description: string
  aliases?: string[]
}

export type CommandContext = {
  currentProvider: string
  setCurrentProvider: (id: string) => void
  currentModel: string
  setCurrentModel: (name: string) => void
  mode: "build" | "plan"
  setMode: (mode: "build" | "plan") => void
  messages: () => Message[]
  setMessages: Setter<Message[]>
  setDraft: (text: string) => void
  setNotices: Setter<DisplayBlock[]>
  exitApp: (code?: number) => Promise<void>
  scrollBottom: () => void
}



export const BUILTIN_COMMANDS: SlashCommandDef[] = [
  { name: "help", description: "Show available commands" },
  { name: "clear", description: "Clear conversation history", aliases: ["new"] },
  { name: "info", description: "Show session info" },
  { name: "model", description: "Switch model: /model <name>" },
  { name: "mode", description: "Switch mode: /mode build|plan" },
  { name: "exit", description: "Exit program", aliases: ["quit"] },
]

export function executeCommand(input: string, ctx: CommandContext): boolean {
  const parts = input.slice(1).trim().split(/\s+/)
  const cmd = parts[0]?.toLowerCase()
  const arg = parts.slice(1).join(" ")

  if (cmd === "model") {
    if (arg) {
      ctx.setCurrentModel(arg)
      ctx.setNotices((prev) => [...prev, { kind: "tool", text: `model -> ${arg}` }])
    } else {
      ctx.setNotices((prev) => [...prev, { kind: "system", text: `Current model: ${ctx.currentModel}` }])
    }
    return true
  }

  if (cmd === "mode") {
    const next = arg.toLowerCase()
    if (next === "build" || next === "plan") {
      ctx.setMode(next)
      ctx.setNotices((prev) => [...prev, { kind: "system", text: `Mode switched to ${next}.` }])
    } else if (!arg) {
      ctx.setNotices((prev) => [...prev, { kind: "system", text: `Current mode: ${ctx.mode}` }])
    } else {
      ctx.setNotices((prev) => [...prev, { kind: "error", text: "Usage: /mode build|plan" }])
    }
    return true
  }

  if (cmd === "help") {
    const lines = [
      "Commands:",
      ...BUILTIN_COMMANDS.map((c) => {
        const aliases = c.aliases?.length ? ` (aliases: ${c.aliases.map((a) => `/${a}`).join(", ")})` : ""
        return `  /${c.name}${aliases.padEnd(20)} ${c.description}`
      }),
      "Scroll:",
      "  mouse wheel scrolls the response area only",
      "  PgUp/PgDn scroll response",
      "  Home/End jump to top/bottom",
    ]
    for (const line of lines) {
      ctx.setNotices((prev) => [...prev, { kind: "system", text: line }])
    }
    return true
  }

  if (cmd === "clear" || cmd === "new") {
    ctx.setMessages([])
    ctx.setNotices([])
    saveSession([])
    ctx.setDraft("")
    return true
  }

  if (cmd === "info") {
    ctx.setNotices((prev) => [...prev, { kind: "system", text: `Messages: ${ctx.messages().length}` }])
    return true
  }

  if (cmd === "exit" || cmd === "quit") {
    void ctx.exitApp(0)
    return true
  }

  return false
}
