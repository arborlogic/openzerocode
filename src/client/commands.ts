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
  setCurrentProvider: (id: string) => Promise<{ ok: boolean; message: string }>
  currentProviderKeyName: (providerId?: string) => string | undefined
  listProviderKeys: (providerId: string) => string[]
  getProviderKeyConfigPath: () => string
  setProviderKey: (providerId: string, keyName: string) => Promise<{ ok: boolean; message: string }>
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
  refreshSessions: () => void
}

export const BUILTIN_COMMANDS: SlashCommandDef[] = [
  { name: "help", description: "Show available commands" },
  { name: "clear", description: "Clear conversation history", aliases: ["new"] },
  { name: "info", description: "Show session info" },
  { name: "provider", description: "Switch provider: /provider <id>" },
  { name: "provider-key", description: "Provider key config: /provider-key path|list [provider]|use <provider> <key-name>" },
  { name: "model", description: "Switch model: /model <name> or /model <provider>/<name>" },
  { name: "mode", description: "Switch mode: /mode build|plan" },
  { name: "sessions", description: "Open session list", aliases: ["s"] },
  { name: "session", description: "Manage sessions: /session new|open|delete|rename" },
  { name: "tools", description: "Toggle completed tool details visibility", aliases: ["tool-details"] },
  { name: "thinking", description: "Toggle thinking blocks visibility" },
  { name: "auto", description: "Toggle auto-approve mode", aliases: ["auto-approve"] },
  { name: "exit", description: "Exit program", aliases: ["quit"] },
]

export async function executeCommand(input: string, ctx: CommandContext): Promise<boolean> {
  const parts = input.slice(1).trim().split(/\s+/)
  const cmd = parts[0]?.toLowerCase()
  const arg = parts.slice(1).join(" ")
  const args = parts.slice(1)

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

  if (cmd === "provider-key") {
    const sub = args[0]?.toLowerCase()
    if (!sub) {
      const providerId = ctx.currentProvider
      const active = ctx.currentProviderKeyName(providerId) ?? "none"
      ctx.setNotices((prev) => [...prev, { kind: "system", text: `Provider key (${providerId}): ${active}` }])
      return true
    }
    if (sub === "path") {
      ctx.setNotices((prev) => [...prev, { kind: "system", text: `Provider config: ${ctx.getProviderKeyConfigPath()}` }])
      return true
    }
    if (sub === "list") {
      const providerId = args[1] ?? ctx.currentProvider
      const keys = ctx.listProviderKeys(providerId)
      const active = ctx.currentProviderKeyName(providerId)
      if (keys.length === 0) {
        ctx.setNotices((prev) => [...prev, { kind: "system", text: `No configured keys for ${providerId}. Edit ${ctx.getProviderKeyConfigPath()}.` }])
        return true
      }
      ctx.setNotices((prev) => [...prev, { kind: "system", text: `Configured keys for ${providerId}:` }])
      for (const key of keys) {
        ctx.setNotices((prev) => [...prev, { kind: "system", text: `  ${key === active ? "*" : "-"} ${key}` }])
      }
      return true
    }
    if (sub === "use" && args[1] && args[2]) {
      const result = await ctx.setProviderKey(args[1], args[2])
      ctx.setNotices((prev) => [...prev, { kind: result.ok ? "system" : "error", text: result.message }])
      return true
    }
    ctx.setNotices((prev) => [...prev, { kind: "error", text: "Usage: /provider-key path | /provider-key list [provider] | /provider-key use <provider> <key-name>" }])
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
      if (args[1] === ctx.currentSessionId()) {
        ctx.setNotices((prev) => [...prev, { kind: "error", text: "Cannot delete current session." }])
        return true
      }
      const ok = deleteSession(args[1])
      ctx.refreshSessions()
      ctx.setNotices((prev) => [...prev, { kind: ok ? "system" : "error", text: ok ? `Deleted session ${args[1]}` : `Session not found: ${args[1]}` }])
      return true
    }

    if (sub === "open" && args[1]) {
      ctx.switchSession(args[1])
      return true
    }

    if (sub === "rename" && args[1] && args[2]) {
      updateSessionMeta(args[1], { title: args.slice(2).join(" ") })
      ctx.refreshSessions()
      ctx.setNotices((prev) => [...prev, { kind: "system", text: "Session renamed." }])
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
