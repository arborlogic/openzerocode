import type { Setter } from "solid-js"
import { HELP_CONTENT } from "./help-content"
import type { DisplayBlock } from "./tui"
import type { Message } from "../provider/types"
import { formatWorkspaceMemoryStatus, inspectWorkspaceMemory } from "./workspace-memory"
import { isExperimentEnabled, setExperimentEnabled } from "./experiments"
import { restoreRecoveryCheckpoint } from "../tool/recovery"

export type SlashCommandDef = {
  name: string
  description: string
  aliases?: string[]
}

export type CommandToastKind = "info" | "success" | "warning" | "error"

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
  showToast: (kind: CommandToastKind, title: string, text?: string, duration?: number) => void
  exitApp: (code?: number) => Promise<void>
  scrollBottom: () => void
  switchSession: (id: string) => void
  createNewSession: () => void
  currentSessionId: () => string | null
  openSessionList: () => void
  openProviderList: () => void
  openModelList: () => void
  openHelp: () => void
  openUsageDashboard: () => void
  openRecoveryList: () => void
  compactSession: () => Promise<void>
  refreshSessions: () => void
  codexLogin: (method?: "browser" | "headless" | "code", value?: string) => Promise<{ ok: boolean; message: string }>
}

export const BUILTIN_COMMANDS: SlashCommandDef[] = [
  { name: "help", description: "Show help, shortcuts and palette guide" },
  { name: "clear", description: "Clear conversation history" },
  { name: "new", description: "Start a fresh session" },
  { name: "provider", description: "Switch provider: /provider <id> or /provider list" },
  { name: "codex-login", description: "Authorize OpenAI Codex with ChatGPT Pro/Plus" },
  { name: "mode", description: "Toggle build / plan mode" },
  { name: "memory", description: "Show loaded workspace memory files and prompt-memory status" },
  { name: "experiment", description: "Manage experiments: /experiment recovery on|off|list|restore <id>" },
  { name: "model", description: "Switch model: /model <name> or /model list" },
  { name: "sessions", description: "Open session switcher", aliases: ["s"] },
  { name: "tools", description: "Toggle completed tool details", aliases: ["tool-details"] },
  { name: "thinking", description: "Toggle thinking blocks" },
  { name: "auto", description: "Toggle auto-approve mode", aliases: ["auto-approve"] },
  { name: "commit", description: "Generate a commit message from current changes" },
  { name: "usage", description: "Show token usage dashboard (by provider/key/model, hourly/daily)" },
  { name: "compact", description: "Summarize and compress earlier session history" },
  { name: "exit", description: "Exit the app", aliases: ["quit"] },
]

function notifyCommand(ctx: CommandContext, kind: CommandToastKind, title: string, text?: string) {
  ctx.showToast(kind, title, text)
}

export async function executeCommand(input: string, ctx: CommandContext): Promise<boolean> {
  const parts = input.slice(1).trim().split(/\s+/)
  const cmd = parts[0]?.toLowerCase()
  const arg = parts.slice(1).join(" ")

  if (cmd === "provider") {
    if (!arg) {
      notifyCommand(ctx, "info", "Current provider", ctx.currentProvider)
      return true
    }
    if (arg === "list") {
      ctx.openProviderList()
      return true
    }
    const result = await ctx.setCurrentProvider(arg)
    notifyCommand(ctx, result.ok ? "success" : "error", result.ok ? "Provider updated" : "Provider update failed", result.message)
    return true
  }

  if (cmd === "codex-login") {
    const [first, ...rest] = arg.split(/\s+/)
    const method = first === "headless" || first === "code" ? first : "browser"
    const value = method === "code" ? rest.join(" ") : undefined
    const result = await ctx.codexLogin(method, value)
    notifyCommand(ctx, result.ok ? "success" : "error", result.ok ? "Codex login started" : "Codex login failed", result.message)
    return true
  }

  if (cmd === "model") {
    if (!arg) {
      notifyCommand(ctx, "info", "Current model", ctx.currentModel)
      return true
    }
    if (arg === "list") {
      ctx.openModelList()
      return true
    }
    const result = await ctx.setCurrentModel(arg)
    notifyCommand(ctx, result.ok ? "success" : "error", result.ok ? "Model updated" : "Model update failed", result.message)
    return true
  }

  if (cmd === "mode") {
    if (!arg) {
      const nextMode = ctx.mode === "build" ? "plan" : "build"
      ctx.setMode(nextMode)
      notifyCommand(ctx, "success", "Mode updated", `Mode set to ${nextMode}`)
    } else if (arg === "build" || arg === "plan") {
      ctx.setMode(arg)
      notifyCommand(ctx, "success", "Mode updated", `Mode set to ${arg}`)
    } else {
      notifyCommand(ctx, "error", "Invalid mode", "Usage: /mode build|plan")
    }
    return true
  }

  if (cmd === "help") {
    ctx.openHelp()
    return true
  }

  if (cmd === "memory") {
    const status = inspectWorkspaceMemory(process.cwd())
    notifyCommand(ctx, "info", "Workspace memory", formatWorkspaceMemoryStatus(status))
    return true
  }

  if (cmd === "usage") {
    ctx.openUsageDashboard()
    return true
  }

  if (cmd === "experiment") {
    const [featureRaw, actionRaw, ...rest] = arg.split(/\s+/).filter(Boolean)
    const feature = featureRaw?.toLowerCase()
    const action = actionRaw?.toLowerCase()

    if (!feature || feature === "status") {
      notifyCommand(ctx, "info", "Experiments", `Lightweight recovery: ${isExperimentEnabled("lightweightRecovery") ? "ON" : "OFF"}`)
      return true
    }

    if (feature !== "recovery" && feature !== "lightweight-recovery") {
      notifyCommand(ctx, "error", "Unknown experiment", "Usage: /experiment recovery on|off|status|list|restore <id>")
      return true
    }

    if (!action || action === "status") {
      notifyCommand(ctx, "info", "Lightweight recovery", isExperimentEnabled("lightweightRecovery") ? "ON" : "OFF")
      return true
    }

    if (action === "on" || action === "enable") {
      setExperimentEnabled("lightweightRecovery", true)
      notifyCommand(ctx, "success", "Lightweight recovery enabled", "write/edit tools will save pre-change checkpoints")
      return true
    }

    if (action === "off" || action === "disable") {
      setExperimentEnabled("lightweightRecovery", false)
      notifyCommand(ctx, "success", "Lightweight recovery disabled")
      return true
    }

    if (action === "list") {
      ctx.openRecoveryList()
      return true
    }

    if (action === "restore") {
      const id = rest.join(" ").trim()
      if (!id) {
        notifyCommand(ctx, "error", "Missing checkpoint id", "Usage: /experiment recovery restore <id>")
        return true
      }
      const result = await restoreRecoveryCheckpoint(process.cwd(), id)
      notifyCommand(ctx, result.ok ? "success" : "error", result.ok ? "Recovery restored" : "Recovery restore failed", result.message)
      return true
    }

    notifyCommand(ctx, "error", "Invalid experiment action", "Usage: /experiment recovery on|off|status|list|restore <id>")
    return true
  }

  if (cmd === "compact") {
    await ctx.compactSession()
    return true
  }

  if (cmd === "clear") {
    ctx.setMessages([])
    ctx.setNotices([])
    ctx.setDraft("")
    return true
  }

  if (cmd === "new") {
    ctx.createNewSession()
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
