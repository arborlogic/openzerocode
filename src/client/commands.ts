import type { Setter } from "solid-js"
import { HELP_CONTENT } from "./help-content"
import type { DisplayBlock } from "./response-entry"
import type { Message } from "../provider/types"
import { formatWorkspaceMemoryStatus, inspectWorkspaceMemory } from "./workspace-memory"
import { getModelConfig } from "../provider/models"
import type { PeerEntry } from "../peer/registry"
import type { AutopilotMode } from "./autopilot"

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
  mode: "build" | "plan" | "compose"
  setMode: (mode: "build" | "plan" | "compose") => void
  reasoningEffort: "low" | "medium" | "high" | "max" | undefined
  setReasoningEffort: (effort: "low" | "medium" | "high" | "max" | undefined) => void
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
  openQueuedMessages: () => void
  openProviderList: () => void
  openModelList: () => void
  openHelp: () => void
  openUsageDashboard: () => void
  compactSession: () => Promise<void>
  viewCompactionSummary: () => void
  exportCompactSession: () => void
  refreshSessions: () => void
  codexLogin: (method?: "browser" | "headless" | "code", value?: string) => Promise<{ ok: boolean; message: string }>
  xaiLogin: () => Promise<{ ok: boolean; message: string }>
  getAutopilotMode: () => AutopilotMode
  setAutopilotMode: (mode: AutopilotMode) => void
  peerName?: string
  listPeers?: () => PeerEntry[]
  callPeer?: (name: string, prompt: string) => Promise<{ ok: boolean; error?: string }>
}

export const BUILTIN_COMMANDS: SlashCommandDef[] = [
  { name: "help", description: "Show help, shortcuts and palette guide" },
  { name: "clear", description: "Clear conversation history" },
  { name: "new", description: "Start a fresh session" },
  { name: "provider", description: "Switch provider: /provider <id> or /provider list" },
  { name: "codex-login", description: "Authorize OpenAI Codex with ChatGPT Pro/Plus" },
  { name: "xai-login", description: "Authorize xAI Grok with SuperGrok / X Premium+ OAuth" },
  { name: "mode", description: "Switch mode: /mode build|plan|compose (no arg toggles)" },
  { name: "learn", description: "Extract non-obvious learnings from this session" },
  { name: "reasoning", description: "Set reasoning effort: /reasoning low|medium|high|max or /reasoning off" },
  { name: "memory", description: "Show loaded global memory files and prompt-memory status" },
  { name: "model", description: "Switch model: /model <name> or /model list" },
  { name: "sessions", description: "Open session switcher", aliases: ["s"] },
  { name: "queue", description: "Open queued messages viewer/cancel menu", aliases: ["queued"] },
  { name: "tools", description: "Toggle completed tool details", aliases: ["tool-details"] },
  { name: "thinking", description: "Toggle thinking blocks" },
  { name: "auto", description: "Toggle auto-approve mode", aliases: ["auto-approve"] },
  { name: "autopilot", description: "Automatic continuation: /autopilot standard|proactive|off" },
  { name: "commit", description: "Generate a commit message from current changes" },
  { name: "usage", description: "Show token usage dashboard (by provider/key/model, hourly/daily)" },
  { name: "compact", description: "Summarize and compress earlier session history (/compact view shows last summary)" },
  { name: "export", description: "Export compact transcript: user asks, AI responses, and compact summary" },
  { name: "exit", description: "Exit the app", aliases: ["quit"] },
  { name: "peers", description: "List online named peer processes" },
  { name: "call", description: "Send a prompt to a named peer: /call <name> <prompt>" },
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

  if (cmd === "xai-login") {
    const result = await ctx.xaiLogin()
    notifyCommand(ctx, result.ok ? "success" : "error", result.ok ? "xAI login started" : "xAI login failed", result.message)
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
      const nextMode = ctx.mode === "build" ? "plan" : ctx.mode === "plan" ? "compose" : "build"
      ctx.setMode(nextMode)
      notifyCommand(ctx, "success", "Mode updated", `Mode set to ${nextMode}`)
    } else if (arg === "build" || arg === "plan" || arg === "compose") {
      ctx.setMode(arg)
      notifyCommand(ctx, "success", "Mode updated", `Mode set to ${arg}`)
    } else {
      notifyCommand(ctx, "error", "Invalid mode", "Usage: /mode build|plan|compose")
    }
    return true
  }

  if (cmd === "reasoning") {
    if (!arg || arg === "off") {
      ctx.setReasoningEffort(undefined)
      notifyCommand(ctx, "info", "Reasoning effort", "Disabled (default)")
    } else if (arg === "low" || arg === "medium" || arg === "high" || arg === "max") {
      ctx.setReasoningEffort(arg)
      const modelCfg = getModelConfig(ctx.currentModel, undefined)
      const msg = modelCfg.reasoning
        ? `Set to ${arg}`
        : `Set to ${arg} (note: current model "${ctx.currentModel}" does not support reasoning_effort; it will be ignored until you switch to a reasoning model like deepseek-v4-pro)`
      notifyCommand(ctx, modelCfg.reasoning ? "success" : "warning", "Reasoning effort", msg)
    } else {
      notifyCommand(ctx, "error", "Invalid reasoning effort", "Usage: /reasoning low|medium|high|max|off")
    }
    return true
  }

  if (cmd === "help") {
    ctx.openHelp()
    return true
  }

  if (cmd === "memory") {
    const status = inspectWorkspaceMemory(process.cwd())
    notifyCommand(ctx, "info", "Prompt memory", formatWorkspaceMemoryStatus(status))
    return true
  }

  if (cmd === "usage") {
    ctx.openUsageDashboard()
    return true
  }

  if (cmd === "autopilot") {
    const normalized = arg.trim().toLowerCase()
    if (!normalized || normalized === "status") {
      notifyCommand(ctx, "info", "Autopilot", ctx.getAutopilotMode().toUpperCase())
      return true
    }
    if (normalized === "off" || normalized === "stop" || normalized === "disable") {
      ctx.setAutopilotMode("off")
      notifyCommand(ctx, "success", "Autopilot stopped", "AI will wait for your next message.")
      return true
    }
    const mode = normalized === "on" || normalized === "start" || normalized === "enable"
      ? "standard"
      : normalized
    if (mode !== "standard" && mode !== "proactive") {
      notifyCommand(ctx, "error", "Invalid autopilot option", "Usage: /autopilot standard|proactive|off|status")
      return true
    }
    ctx.setAutopilotMode(mode)
    notifyCommand(
      ctx,
      "success",
      mode === "proactive" ? "Proactive Autopilot enabled" : "Standard Autopilot enabled",
      mode === "proactive"
        ? "AI will ask for a next-step proposal when needed, then continue safe repo-local work."
        : "AI will answer routine continuation questions when the next step is clear and safe.",
    )
    return true
  }

  if (cmd === "compact") {
    if (arg === "view") {
      ctx.viewCompactionSummary()
      return true
    }
    await ctx.compactSession()
    return true
  }

  if (cmd === "export") {
    ctx.exportCompactSession()
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

  if (cmd === "queue" || cmd === "queued") {
    ctx.openQueuedMessages()
    return true
  }

  if (cmd === "exit" || cmd === "quit") {
    void ctx.exitApp(0)
    return true
  }

  if (cmd === "peers") {
    if (!ctx.listPeers) {
      notifyCommand(ctx, "info", "Peers", "Start with --name to enable peer mode")
      return true
    }
    const peers = ctx.listPeers()
    if (peers.length === 0) {
      notifyCommand(ctx, "info", "Peers", "No named peers online")
    } else {
      const lines = peers.map(p => `${p.name}  ${p.workdir}`).join("\n")
      notifyCommand(ctx, "info", `Peers (${peers.length})`, lines)
    }
    return true
  }

  if (cmd === "call") {
    if (!ctx.callPeer) {
      notifyCommand(ctx, "error", "Peer mode not active", "Start with --name to enable /call")
      return true
    }
    const spaceIdx = arg.indexOf(" ")
    if (!arg || spaceIdx === -1) {
      notifyCommand(ctx, "error", "Usage", "/call <peer-name> <prompt>")
      return true
    }
    const peerName = arg.slice(0, spaceIdx)
    const prompt = arg.slice(spaceIdx + 1).trim()
    if (!prompt) {
      notifyCommand(ctx, "error", "Usage", "/call <peer-name> <prompt>")
      return true
    }
    notifyCommand(ctx, "info", `Calling ${peerName}…`, prompt)
    ctx.callPeer(peerName, prompt).then((result) => {
      if (!result.ok) {
        notifyCommand(ctx, "error", `Call to ${peerName} failed`, result.error)
      }
    })
    return true
  }

  return false
}
