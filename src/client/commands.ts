import type { Setter } from "solid-js"
import { HELP_CONTENT } from "./help-content"
import type { DisplayBlock } from "./tui"
import type { Message } from "../provider/types"

export type SlashCommandDef = {
  name: string
  description: string
  aliases?: string[]
}

export type CommandContext = {
  currentProvider: string
  setCurrentProvider: (id: string) => Promise<{ ok: boolean; message: string }>
  currentModel: string
  setCurrentModel: (name: string) => Promise<{ ok: boolean; message: string }>
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
  openProviderList: () => void
  openModelList: () => void
  openHelp: () => void
  refreshSessions: () => void
}

export const BUILTIN_COMMANDS: SlashCommandDef[] = [
  { name: "help", description: "Show help, shortcuts and palette guide" },
  { name: "clear", description: "Clear conversation history", aliases: ["new"] },
  { name: "provider", description: "Switch provider: /provider <id> or /provider list" },
  { name: "mode", description: "Toggle build / plan mode" },
  { name: "model", description: "Switch model: /model <name> or /model list" },
  { name: "sessions", description: "Open session switcher", aliases: ["s"] },
  { name: "tools", description: "Toggle completed tool details", aliases: ["tool-details"] },
  { name: "thinking", description: "Toggle thinking blocks" },
  { name: "auto", description: "Toggle auto-approve mode", aliases: ["auto-approve"] },
  { name: "commit", description: "Generate a commit message from current changes" },
  { name: "exit", description: "Exit the app", aliases: ["quit"] },
]


export async function executeCommand(input: string, ctx: CommandContext): Promise<boolean> {
  const parts = input.slice(1).trim().split(/\s+/)
  const cmd = parts[0]?.toLowerCase()
  const arg = parts.slice(1).join(" ")

  if (cmd === "provider") {
    if (!arg) {
      ctx.setNotices((prev) => [...prev, { kind: "system", text: `Current provider: ${ctx.currentProvider}` }])
      return true
    }
    if (arg === "list") {
      ctx.openProviderList()
      return true
    }
    const result = await ctx.setCurrentProvider(arg)
    ctx.setNotices((prev) => [...prev, { kind: result.ok ? "system" : "error", text: result.message }])
    return true
  }

  if (cmd === "model") {
    if (!arg) {
      ctx.setNotices((prev) => [...prev, { kind: "system", text: `Current model: ${ctx.currentModel}` }])
      return true
    }
    if (arg === "list") {
      ctx.openModelList()
      return true
    }
    const result = await ctx.setCurrentModel(arg)
    ctx.setNotices((prev) => [...prev, { kind: result.ok ? "system" : "error", text: result.message }])
    return true
  }

  if (cmd === "mode") {
    const next = arg.toLowerCase()
    if (next === "build" || next === "plan") {
      ctx.setMode(next)
      ctx.setNotices((prev) => [...prev, { kind: "system", text: `Mode switched to ${next}.` }])
    } else if (!arg) {
      const toggled = ctx.mode === "build" ? "plan" : "build"
      ctx.setMode(toggled)
      ctx.setNotices((prev) => [...prev, { kind: "system", text: `Mode switched to ${toggled}.` }])
    } else {
      ctx.setNotices((prev) => [...prev, { kind: "error", text: "Usage: /mode build|plan" }])
    }
    return true
  }

  if (cmd === "help") {
    ctx.openHelp()
    return true
  }

  if (cmd === "clear" || cmd === "new") {
    ctx.setMessages([])
    ctx.setNotices([])
    ctx.setDraft("")
    return true
  }

  if (cmd === "sessions" || cmd === "s") {
    ctx.openSessionList()
    return true
  }

  if (cmd === "exit" || cmd === "quit") {
    void ctx.exitApp(0)
    return true
  }

  return false
}
