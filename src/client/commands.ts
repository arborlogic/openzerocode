import type { Setter } from "solid-js"
import type { DisplayBlock } from "./tui"
import type { Message } from "../provider/types"
import { deleteSession, updateSessionMeta } from "./sessions"

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
  switchSession: (id: string) => void
  createNewSession: () => void
  currentSessionId: () => string | null
  openSessionList: () => void
}

export const BUILTIN_COMMANDS: SlashCommandDef[] = [
  { name: "help", description: "Show available commands" },
  { name: "clear", description: "Clear conversation history", aliases: ["new"] },
  { name: "info", description: "Show session info" },
  { name: "model", description: "Switch model: /model <name>" },
  { name: "mode", description: "Switch mode: /mode build|plan" },
  { name: "sessions", description: "List all sessions", aliases: ["s"] },
  { name: "session", description: "Manage sessions: /session new|delete|rename" },
  { name: "exit", description: "Exit program", aliases: ["quit"] },
]

export function executeCommand(input: string, ctx: CommandContext): boolean {
  const parts = input.slice(1).trim().split(/\s+/)
  const cmd = parts[0]?.toLowerCase()
  const arg = parts.slice(1).join(" ")
  const args = parts.slice(1)

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
    ctx.setDraft("")
    return true
  }

  if (cmd === "info") {
    const sid = ctx.currentSessionId()
    ctx.setNotices((prev) => [...prev, { kind: "system", text: `Messages: ${ctx.messages().length}  Session: ${sid ?? "none"}` }])
    return true
  }

  if (cmd === "sessions" || (cmd === "s" && !args[0])) {
    ctx.openSessionList()
    return true
  }

  if (cmd === "session") {
    const sub = args[0]?.toLowerCase()

    if (sub === "new") {
      ctx.createNewSession()
      return true
    }

    if (sub === "delete" && args[1]) {
      const ok = deleteSession(args[1])
      ctx.setNotices((prev) => [...prev, { kind: ok ? "tool" : "error", text: ok ? `Deleted session ${args[1]}` : `Session not found: ${args[1]}` }])
      return true
    }

    if (sub === "open" && args[1]) {
      ctx.switchSession(args[1])
      return true
    }

    if (sub === "rename" && args[1] && args[2]) {
      updateSessionMeta(args[1], { title: args.slice(2).join(" ") })
      ctx.setNotices((prev) => [...prev, { kind: "tool", text: `Session renamed.` }])
      return true
    }

    ctx.setNotices((prev) => [...prev, { kind: "error", text: "Usage: /session new|delete <id>|open <id>|rename <id> <title>" }])
    return true
  }

  if (cmd === "exit" || cmd === "quit") {
    void ctx.exitApp(0)
    return true
  }

  return false
}
