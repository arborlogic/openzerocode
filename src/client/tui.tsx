import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { ScrollBoxRenderable, TextareaRenderable, KeyBinding } from "@opentui/core"
import { Effect, Layer } from "effect"
import { spawn } from "node:child_process"
import { platform } from "os"
import { buildLayer, autoDetectProvider, defaultModelForProvider, PROVIDERS, normalizeBigPickleModel } from "../provider/index"
import { layer as toolLayer } from "../tool/registry"
import { ToolRegistry } from "../tool/registry"
import { Provider } from "../provider/types"
import type { Message } from "../provider/types"
import { renderMarkdown } from "./markdown"
import { createStreamState } from "./stream-state"
import { runSession, type RunMode } from "./session-runner"
import { SlashAutocomplete } from "./autocomplete"
import type { AutocompleteApi } from "./autocomplete"
import { BUILTIN_COMMANDS, executeCommand, type CommandContext } from "./commands"
import { Sidebar } from "./sidebar"
import { createSession, deleteSession, getCurrentSessionId, loadSessionState, saveSession, setCurrentSessionId, currentSessionMeta, listSessions, updateSessionMeta } from "./sessions"
import { getKnownModelConfig, getModelConfig } from "../provider/models"
import { buildCompactionTranscript, createCompactSummaryMessage, selectCompactionTail } from "./session-compact"
import { loadWorkspaceMemory } from "./workspace-memory"
import { buildSessionSummaryPrompt, writeSessionSummary } from "./workspace-summary"
import { getActiveConfiguredProviderKeyName, getProviderConfigPath, listConfiguredProviderKeys, setActiveConfiguredProviderKey } from "../provider/config"

let currentProvider = autoDetectProvider() ?? "openapi"
let currentModel = normalizeBigPickleModel(process.env.OPENZERO_MODEL ?? defaultModelForProvider(currentProvider))
let currentLayer = Layer.merge(buildLayer(currentProvider, currentModel), toolLayer)
let workspaceMemory = loadWorkspaceMemory(process.cwd())

const SYSTEM_PROMPT = [
  "You are OpenZeroCode, an AI coding assistant.",
  "You have access to tools for reading, writing, searching files and running shell commands.",
  "Use tools when the user asks you to perform actions like running commands or accessing files.",
  "For simple conversation or questions, just respond directly without tools.",
  "Be concise and helpful.",
].join("\n")

const THEME = {
  background: "#0d1117",
  surface: "#161b22",
  panel: "#0d1117",
  border: "#30363d",
  text: "#e6edf3",
  muted: "#8b949e",
  accent: "#58a6ff",
  accentDim: "#1f6feb",
  user: "#7ee787",
  tool: "#d2a8ff",
  error: "#f85149",
  warning: "#d29922",
  headerBg: "#161b22",
  headerBorder: "#21262d",
}
const EMPTY_STATE_MESSAGE = "Response scroll is locked inside the panel. Mouse wheel scrolls response only."
const SCROLL_HINT = "Enter submit  •  Shift/Ctrl/Alt+Enter newline  •  / commands  •  Ctrl+P palette"
const PROMPT_KEY_BINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "return", ctrl: true, action: "newline" },
  { name: "return", meta: true, action: "newline" },
  { name: "j", ctrl: true, action: "newline" },
]

export type DisplayBlock = {
  kind: "user" | "assistant" | "reasoning" | "tool" | "tool-call" | "error" | "system"
  text: string
  title?: string
}

type DisplayTurn = {
  user?: DisplayBlock
  entries: DisplayBlock[]
  footer?: string
}

function rebuildLayer() {
  currentLayer = Layer.merge(buildLayer(currentProvider, currentModel), toolLayer)
}

function defaultModelForCurrentProvider(providerId: string) {
  const configured = process.env.OPENZERO_MODEL ?? defaultModelForProvider(providerId)
  return providerId === "openapi" ? normalizeBigPickleModel(configured) : configured
}

function runSync<E, A>(effect: Effect.Effect<A, E, ToolRegistry | Provider>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(currentLayer)))
}

function tryParseJSON(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) } catch { return {} }
}

function stripAnsi(str: string) {
  return str.replace(/\x1b\[[0-9;]*m/g, "")
}

function renderAssistantText(text: string) {
  const rendered = renderMarkdown(text).trim()
  return rendered || text
}

function truncateText(text: string, max: number) {
  if (max <= 0) return ""
  if (text.length <= max) return text
  if (max <= 1) return "…"
  return text.slice(0, max - 1) + "…"
}

function fmtContextLimit(limit: number) {
  if (limit >= 1_000_000) {
    const millions = limit / 1_000_000
    return `${Number.isInteger(millions) ? millions.toFixed(0) : millions.toFixed(1)}m`
  }
  return `${Math.round(limit / 1000)}k`
}

function fmtPrice(value: number) {
  if (value === 0) return "free"
  if (value >= 1) return `$${value}`
  return `$${value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}`
}

function modelHint(model: string) {
  const cfg = getKnownModelConfig(model)
  if (!cfg) return ""
  if (!cfg.pricing) return fmtContextLimit(cfg.contextLimit)
  if (cfg.pricing.input === 0 && cfg.pricing.output === 0) return `${fmtContextLimit(cfg.contextLimit)} • free`
  return `${fmtContextLimit(cfg.contextLimit)} • ${fmtPrice(cfg.pricing.input)}/${fmtPrice(cfg.pricing.output)}`
}

function isTransientPasteMarker(input: string) {
  return /^\[Pasted ~.*$/.test(input.trim())
}

async function copyToClipboard(text: string) {
  if (!text) return
  if (process.stdout.isTTY) {
    const base64 = Buffer.from(text).toString("base64")
    process.stdout.write(`\x1b]52;c;${base64}\x07`)
  }

  const command = platform() === "darwin"
    ? ["pbcopy"]
    : platform() === "win32"
      ? ["clip"]
      : ["xclip", "-selection", "clipboard"]

  await new Promise<void>((resolve) => {
    const child = spawn(command[0]!, command.slice(1), { stdio: ["pipe", "ignore", "ignore"] })
    child.on("error", () => resolve())
    child.on("close", () => resolve())
    child.stdin?.write(text)
    child.stdin?.end()
  })
}

function systemPrompt(mode: RunMode) {
  const parts = [SYSTEM_PROMPT]

  if (mode === "plan") {
    parts.push(
      "You are currently in Plan mode.",
      "Do not write code, do not call tools, and do not make changes.",
      "Explain the approach, risks, and step-by-step plan only.",
    )
  }

  if (workspaceMemory.contextBlock) {
    parts.push(workspaceMemory.contextBlock)
  }

  return parts.join("\n\n")
}

function refreshWorkspaceMemory() {
  workspaceMemory = loadWorkspaceMemory(process.cwd())
}

function messageToBlocks(msg: Message): DisplayBlock[] {
  if (msg.parts && msg.parts.length > 0) {
    return msg.parts.map((part): DisplayBlock => {
        switch (part.type) {
          case "text":
            return { kind: "assistant", text: renderAssistantText(part.text) }
          case "reasoning":
            return { kind: "reasoning", text: part.text, title: "Thinking" }
          case "tool-call":
            return { kind: "tool-call", text: part.input, title: part.tool }
          case "tool-result":
            return { kind: part.error ? "error" : "tool", text: part.output, title: part.tool }
          default:
            return { kind: "system", text: "" }
        }
      })
  }

  switch (msg.role) {
    case "assistant": {
      const result: DisplayBlock[] = []
      if (msg.reasoning_content) result.push({ kind: "reasoning", text: msg.reasoning_content, title: "Thinking" })
      if (msg.content) result.push({ kind: "assistant", text: renderAssistantText(msg.content) })
      return result
    }
    case "user":
      return msg.content ? [{ kind: "user", text: msg.content }] : []
    case "tool":
      return msg.content ? [{ kind: "tool", text: msg.content, title: msg.tool_call_id }] : []
    case "system":
      return msg.content ? [{ kind: "system", text: msg.content }] : []
    default:
      return []
  }
}

const SIDEBAR_WIDTH = 34

function ResponseEntry(props: { entry: DisplayBlock; isFirst: boolean }) {
  const collapsible = () => props.entry.kind === "reasoning" || props.entry.kind === "tool-call" || props.entry.kind === "tool"
  const [collapsed, setCollapsed] = createSignal(collapsible())
  const showHeader = () => props.entry.kind === "reasoning"
    || props.entry.kind === "tool-call"
    || props.entry.kind === "tool"
    || props.entry.kind === "error"
    || !!props.entry.title

  const label = () => props.entry.kind === "assistant" ? "assistant"
    : props.entry.kind === "user" ? "you"
    : props.entry.kind === "reasoning" ? "think"
    : props.entry.kind === "error" ? "error"
    : props.entry.kind === "tool" ? "tool"
    : props.entry.kind === "tool-call" ? "call"
    : "system"

  const labelColor = () => props.entry.kind === "user" ? THEME.user
    : props.entry.kind === "reasoning" ? THEME.accent
    : props.entry.kind === "tool" || props.entry.kind === "tool-call" ? THEME.tool
    : props.entry.kind === "error" ? THEME.error
    : THEME.muted

  const borderColor = () => props.entry.kind === "user" ? THEME.user
    : props.entry.kind === "reasoning" ? THEME.accent
    : props.entry.kind === "tool" || props.entry.kind === "tool-call" ? THEME.tool
    : props.entry.kind === "error" ? THEME.error
    : THEME.border

  const textColor = () => props.entry.kind === "reasoning" || props.entry.kind === "system" ? THEME.muted : THEME.text

  if (props.entry.kind === "assistant" || props.entry.kind === "system") {
    return (
      <box marginTop={props.isFirst ? 0 : 1}>
        <text style={{ fg: textColor() }}>{props.entry.text}</text>
      </box>
    )
  }

  return (
    <box
      marginTop={props.isFirst ? 0 : 1}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      border={["left"]}
      borderColor={borderColor()}
    >
      <box flexDirection="column" gap={1}>
        <Show when={showHeader()}>
          <box
            flexDirection="row"
            gap={1}
            onMouseDown={() => collapsible() && setCollapsed(c => !c)}
          >
            <Show when={collapsible()}>
              <text style={{ fg: labelColor() }}>{collapsed() ? "+" : "-"}</text>
            </Show>
            <text style={{ fg: labelColor() }}>
              {label()}{props.entry.title ? ` ${props.entry.title}` : ""}
            </text>
          </box>
        </Show>
        <Show when={!collapsed()}>
          <text style={{ fg: textColor() }}>{props.entry.text}</text>
        </Show>
      </box>
    </box>
  )
}

function TurnEntry(props: { turn: DisplayTurn; isFirst: boolean }) {
  return (
    <box flexDirection="column" marginTop={props.isFirst ? 0 : 1} gap={1}>
      <Show when={props.turn.user}>
        <box
          paddingLeft={2}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          border={["left"]}
          borderColor={THEME.user}
        >
          <text style={{ fg: THEME.text }}>{props.turn.user?.text ?? ""}</text>
        </box>
      </Show>

      <Show when={props.turn.entries.length > 0}>
        <box
          flexDirection="column"
          paddingLeft={2}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          border={["left"]}
          borderColor={THEME.accentDim}
        >
          <For each={props.turn.entries}>
            {(entry, index) => <ResponseEntry entry={entry} isFirst={index() === 0} />}
          </For>
          <Show when={props.turn.footer}>
            <box marginTop={1}>
              <text style={{ fg: THEME.muted }}>{props.turn.footer}</text>
            </box>
          </Show>
        </box>
      </Show>
    </box>
  )
}

function App() {
  const dimensions = useTerminalDimensions()
  const sessionStart = new Date()
  const renderer = useRenderer()

  let initialMessages: Message[] = []
  let sid = getCurrentSessionId()
  if (sid) {
    const loaded = loadSessionState(sid)
    const meta = currentSessionMeta()
    if (loaded) {
      initialMessages = loaded.messages
      if (loaded.provider) currentProvider = loaded.provider
      if (loaded.model) currentModel = loaded.provider === "openapi" ? normalizeBigPickleModel(loaded.model) : loaded.model
    }
    if (meta?.provider) currentProvider = meta.provider
    if (meta?.model) currentModel = meta.provider === "openapi" ? normalizeBigPickleModel(meta.model) : meta.model
    try {
      rebuildLayer()
    } catch {
      currentProvider = autoDetectProvider() ?? "openapi"
      currentModel = defaultModelForCurrentProvider(currentProvider)
      rebuildLayer()
    }
  }
  if (!sid) {
    sid = createSession(currentModel, currentProvider).id
  }
  const [sessionId, setSessionId] = createSignal(sid)
  const [sessionMeta, setSessionMeta] = createSignal(currentSessionMeta())
  const [messages, setMessages] = createSignal(initialMessages)
  const [status, setStatus] = createSignal("waiting for input")
  const [draft, setDraft] = createSignal("")
  const [running, setRunning] = createSignal(false)
  const [mode, setMode] = createSignal<RunMode>("build")
  const [copyNotice, setCopyNotice] = createSignal(false)
  const [showPalette, setShowPalette] = createSignal(false)
  const [paletteIndex, setPaletteIndex] = createSignal(0)
  const [paletteMode, setPaletteMode] = createSignal<"actions" | "sessions" | "rename" | "providers" | "models" | "providerKeyProviders" | "providerKeys">("actions")
  const [paletteInput, setPaletteInput] = createSignal("")
  const [palettePendingDelete, setPalettePendingDelete] = createSignal<string | null>(null)
  const [paletteProviderTarget, setPaletteProviderTarget] = createSignal(currentProvider)
  const [paletteModelBackMode, setPaletteModelBackMode] = createSignal<"actions" | "providers">("actions")
  const [paletteProviderKeyTarget, setPaletteProviderKeyTarget] = createSignal(currentProvider)
  const [sessionRevision, setSessionRevision] = createSignal(0)
  const [selectionRevision, setSelectionRevision] = createSignal(0)
  const [providerConfigRevision, setProviderConfigRevision] = createSignal(0)
  const [providerModels, setProviderModels] = createSignal<Record<string, string[]>>({})
  const [providerModelsLoading, setProviderModelsLoading] = createSignal<string | null>(null)
  const [providerModelsError, setProviderModelsError] = createSignal<Record<string, string>>({})
  const streamState = createStreamState()
  const [notices, setNotices] = createSignal<DisplayBlock[]>([])
  const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  const [spinnerFrame, setSpinnerFrame] = createSignal(0)
  createEffect(() => {
    if (!running()) return
    const id = setInterval(() => setSpinnerFrame(f => (f + 1) % SPINNER_FRAMES.length), 80)
    return () => clearInterval(id)
  })
  let scroll: ScrollBoxRenderable | undefined
  let composer: TextareaRenderable | undefined
  let autocompleteApi: AutocompleteApi | undefined
  let exitTask: Promise<void> | undefined
  let runAbort: AbortController | undefined
  let history: string[] = []
  let historyIndex = -1
  let historyDraft = ""
  const PALETTE_WIDTH = 52
  const PALETTE_LABEL_MAX = 34
  const PALETTE_HINT_MAX = 12

  type PaletteItem = { label: string; hint?: string; onSelect: () => void; kind?: "item" | "section"; sessionId?: string }

  const isSelectablePaletteItem = (item: PaletteItem | undefined) => item?.kind !== "section"

  const firstSelectablePaletteIndex = (items: PaletteItem[]) => {
    const index = items.findIndex(isSelectablePaletteItem)
    return index >= 0 ? index : 0
  }

  const movePaletteIndex = (delta: -1 | 1) => {
    const items = paletteItems()
    if (items.length === 0) return
    let next = paletteIndex()
    while (true) {
      const candidate = Math.max(0, Math.min(items.length - 1, next + delta))
      if (candidate === next) return
      next = candidate
      if (isSelectablePaletteItem(items[next])) {
        setPaletteIndex(next)
        return
      }
    }
  }

  const providerLabel = createMemo(() => {
    selectionRevision()
    return currentProvider
  })

  const modelLabel = createMemo(() => {
    selectionRevision()
    return currentModel
  })

  const activeProviderKeyLabel = createMemo(() => {
    providerConfigRevision()
    return getActiveConfiguredProviderKeyName(currentProvider) ?? "none"
  })

  const applyProviderModel = (providerId: string, model: string, persist = false) => {
    try {
      const nextProvider = providerId
      const nextModel = nextProvider === "openapi" ? normalizeBigPickleModel(model) : model
      currentLayer = Layer.merge(buildLayer(nextProvider, nextModel), toolLayer)
      currentProvider = nextProvider
      currentModel = nextModel
      setSelectionRevision((value) => value + 1)
      if (persist) saveSession(sessionId(), messages(), currentModel, currentProvider)
      refreshSessions()
      return true
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  const loadModelsForProvider = async (providerId: string) => {
    if (providerModels()[providerId] || providerModelsLoading() === providerId) return
    setProviderModelsLoading(providerId)
    setProviderModelsError((prev) => ({ ...prev, [providerId]: "" }))
    try {
      const layer = Layer.merge(buildLayer(providerId, currentModel), toolLayer)
      const models = await Effect.runPromise(
        Effect.gen(function* () {
          const provider = yield* Provider
          return yield* provider.models()
        }).pipe(Effect.provide(layer)),
      )
      const unique = [...new Set(models)].sort((a, b) => a.localeCompare(b))
      setProviderModels((prev) => ({ ...prev, [providerId]: unique.length > 0 ? unique : [currentModel] }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setProviderModelsError((prev) => ({ ...prev, [providerId]: message }))
    } finally {
      setProviderModelsLoading((loading) => (loading === providerId ? null : loading))
    }
  }

  const ensureModelsForProvider = async (providerId: string) => {
    if (!providerModels()[providerId] && providerModelsLoading() !== providerId) {
      await loadModelsForProvider(providerId)
    }
    return providerModels()[providerId] ?? []
  }

  const openModelsPalette = (providerId: string, backMode: "actions" | "providers") => {
    setPalettePendingDelete(null)
    setPaletteProviderTarget(providerId)
    setPaletteModelBackMode(backMode)
    setPaletteInput("")
    setPaletteMode("models")
    setPaletteIndex(0)
    void loadModelsForProvider(providerId)
  }

  const openProviderKeyPalette = (providerId: string) => {
    setPalettePendingDelete(null)
    setPaletteProviderKeyTarget(providerId)
    setPaletteMode("providerKeys")
    setPaletteIndex(0)
  }

  const actionPaletteItems = createMemo<PaletteItem[]>(() => {
    sessionRevision()
    selectionRevision()
    return [
      {
        label: "INPUT",
        kind: "section",
        onSelect: () => {},
      },
      {
        label: "Focus input",
        onSelect: () => { setShowPalette(false) },
      },
      {
        label: "SESSION",
        kind: "section",
        onSelect: () => {},
      },
      {
        label: "New session",
        onSelect: () => { doCreateNewSession(); setShowPalette(false) },
      },
      {
        label: "Switch session",
        onSelect: () => { setPalettePendingDelete(null); setPaletteIndex(0); setPaletteMode("sessions") },
      },
      {
        label: "Rename session",
        onSelect: () => {
          setPaletteInput(sessionMeta()?.title ?? "")
          setPaletteIndex(0)
          setPaletteMode("rename")
        },
      },
      {
        label: "Compact session",
        onSelect: () => { void compactCurrentSession() },
      },
      {
        label: "MODEL",
        kind: "section",
        onSelect: () => {},
      },
      {
        label: "Switch provider",
        hint: providerLabel(),
        onSelect: () => {
          setPalettePendingDelete(null)
          setPaletteMode("providers")
          setPaletteIndex(0)
        },
      },
      {
        label: "Switch model",
        hint: truncateText(modelLabel(), PALETTE_HINT_MAX),
        onSelect: () => openModelsPalette(providerLabel(), "actions"),
      },
      {
        label: "Provider keys",
        hint: truncateText(`${providerLabel()} • ${activeProviderKeyLabel()}`, PALETTE_HINT_MAX),
        onSelect: () => {
          setPalettePendingDelete(null)
          setPaletteMode("providerKeyProviders")
          setPaletteIndex(0)
        },
      },
    ]
  })

  const sessionPaletteItems = createMemo<PaletteItem[]>(() => {
    sessionRevision()
    const sid = sessionId()
    const sessions = listSessions()
    const items: PaletteItem[] = []

    for (const s of sessions) {
      const isCurrent = s.id === sid
      items.push({
        label: (isCurrent ? ">" : " ") + " " + s.title.slice(0, 30),
        hint: String(s.messageCount),
        sessionId: s.id,
        onSelect: () => {
          if (!isCurrent) doSwitchSession(s.id)
          setPalettePendingDelete(null)
          setShowPalette(false)
          setPaletteMode("actions")
        },
      })
    }

    items.push({ label: "", onSelect: () => {} })
    items.push({
      label: "← Back",
      onSelect: () => { setPalettePendingDelete(null); setPaletteMode("actions"); setPaletteIndex(firstSelectablePaletteIndex(actionPaletteItems())) },
    })
    return items
  })

  const providerPaletteItems = createMemo<PaletteItem[]>(() => {
    selectionRevision()
    const seen = new Set<string>()
    const items = Object.values(PROVIDERS).filter((provider) => {
      if (seen.has(provider.id)) return false
      seen.add(provider.id)
      return true
    }).map<PaletteItem>((provider) => ({
      label: `${provider.id === providerLabel() ? ">" : " "} ${provider.name}`,
      hint: truncateText(provider.id, PALETTE_HINT_MAX),
      onSelect: () => openModelsPalette(provider.id, "providers"),
    }))

    items.push({ label: "", onSelect: () => {} })
    items.push({
      label: "← Back",
      onSelect: () => {
        setPaletteMode("actions")
        setPaletteIndex(firstSelectablePaletteIndex(actionPaletteItems()))
      },
    })
    return items
  })

  const modelPaletteItems = createMemo<PaletteItem[]>(() => {
    selectionRevision()
    const providerId = paletteProviderTarget()
    const loading = providerModelsLoading() === providerId
    const error = providerModelsError()[providerId]
    const models = providerModels()[providerId] ?? []
    const filter = paletteInput().trim().toLowerCase()
    const filteredModels = !filter
      ? models
      : models.filter((model) => model.toLowerCase().includes(filter))
    const visibleModels = filteredModels.slice(0, 10)
    const items: PaletteItem[] = []

    if (loading) {
      items.push({ label: "Loading models...", kind: "section", onSelect: () => {} })
    }

    if (error) {
      items.push({ label: error.slice(0, 44), kind: "section", onSelect: () => {} })
    }

    if (!loading && models.length === 0 && !error) {
      items.push({ label: "No models available", kind: "section", onSelect: () => {} })
    }

    if (!loading && models.length > 0) {
      items.push({
        label: filter
          ? `Showing ${visibleModels.length} / ${filteredModels.length} match(es)`
          : `Showing ${visibleModels.length} / ${models.length} model(s)`,
        kind: "section",
        onSelect: () => {},
      })
      if (filteredModels.length > 10) {
        items.push({
          label: "Type to narrow results",
          kind: "section",
          onSelect: () => {},
        })
      }
      if (filter && filteredModels.length === 0) {
        items.push({
          label: "No models match current filter",
          kind: "section",
          onSelect: () => {},
        })
      }
    }

    for (const model of visibleModels) {
      const isCurrent = providerId === providerLabel() && model === modelLabel()
      items.push({
        label: `${isCurrent ? ">" : " "} ${model}`,
        hint: truncateText(modelHint(model), PALETTE_HINT_MAX),
        onSelect: () => {
          if (!applyProviderModel(providerId, model, true)) return
          setStatus(`provider/model -> ${providerId}/${model}`)
          setShowPalette(false)
          setPaletteMode("actions")
        },
      })
    }

    items.push({ label: "", onSelect: () => {} })
    items.push({
      label: "← Back",
      onSelect: () => {
        const backMode = paletteModelBackMode()
        setPaletteMode(backMode)
        setPaletteIndex(firstSelectablePaletteIndex(backMode === "providers" ? providerPaletteItems() : actionPaletteItems()))
      },
    })
    return items
  })

  const providerKeyProviderPaletteItems = createMemo<PaletteItem[]>(() => {
    selectionRevision()
    providerConfigRevision()
    const seen = new Set<string>()
    const items = Object.values(PROVIDERS).filter((provider) => {
      if (seen.has(provider.id)) return false
      seen.add(provider.id)
      return true
    }).map<PaletteItem>((provider) => {
      const active = getActiveConfiguredProviderKeyName(provider.id) ?? "env"
      const resolved = getActiveConfiguredProviderKeyName(provider.id) ?? "none"
      const isCurrent = provider.id === providerLabel()
      return {
        label: `${isCurrent ? ">" : " "} ${provider.name}`,
        hint: truncateText(`${provider.id} • ${resolved}`, PALETTE_HINT_MAX),
        onSelect: () => openProviderKeyPalette(provider.id),
      }
    })

    items.push({ label: "", onSelect: () => {} })
    items.push({
      label: "← Back",
      onSelect: () => {
        setPaletteMode("actions")
        setPaletteIndex(firstSelectablePaletteIndex(actionPaletteItems()))
      },
    })
    return items
  })

  const providerKeyPaletteItems = createMemo<PaletteItem[]>(() => {
    providerConfigRevision()
    const providerId = paletteProviderKeyTarget()
    const active = getActiveConfiguredProviderKeyName(providerId)
    const keys = listConfiguredProviderKeys(providerId)
    const items: PaletteItem[] = []

    items.push({
      label: `Config: ${getProviderConfigPath()}`,
      kind: "section",
      onSelect: () => {},
    })

    if (keys.length === 0) {
      items.push({
        label: "No configured keys",
        kind: "section",
        onSelect: () => {},
      })
    }

    for (const key of keys) {
      items.push({
        label: `${key === active ? ">" : " "} ${key}`,
        hint: truncateText(providerId, PALETTE_HINT_MAX),
        onSelect: () => {
          const result = setActiveConfiguredProviderKey(providerId, key)
          if (!result.ok) {
            setStatus(result.message)
            return
          }
          setProviderConfigRevision((value) => value + 1)
          setProviderModels((prev) => {
            const next = { ...prev }
            delete next[providerId]
            return next
          })
          setProviderModelsError((prev) => {
            const next = { ...prev }
            delete next[providerId]
            return next
          })
          if (providerId === currentProvider) rebuildLayer()
          setStatus(result.message)
          setShowPalette(false)
          setPaletteMode("actions")
        },
      })
    }

    items.push({ label: "", onSelect: () => {} })
    items.push({
      label: "← Back",
      onSelect: () => {
        setPaletteMode("providerKeyProviders")
        setPaletteIndex(firstSelectablePaletteIndex(providerKeyProviderPaletteItems()))
      },
    })
    return items
  })

  const paletteItems = createMemo<PaletteItem[]>(() =>
    paletteMode() === "sessions"
      ? sessionPaletteItems()
      : paletteMode() === "providers"
        ? providerPaletteItems()
        : paletteMode() === "models"
          ? modelPaletteItems()
          : paletteMode() === "providerKeyProviders"
            ? providerKeyProviderPaletteItems()
            : paletteMode() === "providerKeys"
              ? providerKeyPaletteItems()
          : actionPaletteItems(),
  )

  createEffect(() => {
    if (!showPalette()) return
    if (paletteMode() !== "models") return
    paletteInput()
    setPaletteIndex(firstSelectablePaletteIndex(paletteItems()))
  })

  const turns = createMemo(() => {
    selectionRevision()
    const result: DisplayTurn[] = []
    const assistantFooter = () => `${providerLabel()}/${modelLabel()}  •  select text to copy`
    const footerText = () => `${truncateText(providerLabel(), 12)}/${truncateText(modelLabel(), 28)}  •  select text to copy`

    const ensureTurn = () => {
      const existing = result[result.length - 1]
      if (existing) return existing
      const created: DisplayTurn = { entries: [] }
      result.push(created)
      return created
    }

    for (const msg of messages()) {
      if (msg.role === "user" && msg.content) {
        result.push({
          user: { kind: "user", text: msg.content },
          entries: [],
        })
        continue
      }

      const entries = messageToBlocks(msg)
      if (entries.length === 0) continue
      ensureTurn().entries.push(...entries)
    }

    for (const n of notices()) {
      result.push({ entries: [n] })
    }

    if (running()) {
      const turn = ensureTurn()
      for (const part of streamState.parts()) {
        if (part.type === "reasoning") {
          const text = stripAnsi(part.text).trim()
          if (text) turn.entries.push({ kind: "reasoning", text, title: "Thinking" })
        } else if (part.type === "text") {
          const rendered = renderAssistantText(part.text)
          turn.entries.push({ kind: "assistant", text: rendered })
        }
      }
    }

    for (const turn of result) {
      if (turn.entries.some((entry) =>
        entry.kind === "assistant"
        || entry.kind === "reasoning"
        || entry.kind === "tool"
        || entry.kind === "tool-call"
        || entry.kind === "error",
      )) {
        turn.footer = footerText()
      }
    }

    if (result.length === 0) {
      result.push({ entries: [{ kind: "system", text: EMPTY_STATE_MESSAGE }] })
    }

    return result
  })

  const responseHeight = createMemo(() => Math.max(8, dimensions().height - 8))

  const scrollBottom = () => {
    if (!scroll) return
    scroll.scrollTo(scroll.scrollHeight)
  }

  const setComposerText = (text: string) => {
    setDraft(text)
    composer?.setText(text)
    if (composer) composer.cursorOffset = text.length
  }

  const exitApp = (code = 0) => {
    if (exitTask) return exitTask
    exitTask = (async () => {
      renderer.setTerminalTitle("")
      renderer.destroy()
      process.exit(code)
    })()
    return exitTask
  }

  const copySelection = async () => {
    const selection = renderer.getSelection?.()
    const text = selection?.getSelectedText?.()
    if (!text) return
    await copyToClipboard(text)
    renderer.clearSelection?.()
    setCopyNotice(true)
    setTimeout(() => setCopyNotice(false), 2000)
  }

  const doSaveCurrent = () => {
    const id = sessionId()
    const msgs = messages()
    saveSession(id, msgs, currentModel, currentProvider)
  }

  const generateSessionSummary = async (nextMessages: Message[]) => {
    const last = nextMessages[nextMessages.length - 1]
    if (!last || last.role === "user") return

    const { system, user } = buildSessionSummaryPrompt(nextMessages)

    try {
      const result = await runSync(Effect.gen(function* () {
        const provider = yield* Provider
        return yield* provider.complete({
          model: currentModel,
          stream: false,
          max_tokens: 1400,
          temperature: 0,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        })
      }))

      const summary = result.message.content?.trim()
      if (!summary) return

      const path = writeSessionSummary(summary, process.cwd())
      refreshWorkspaceMemory()
      if (path) {
        setNotices((prev) => [...prev, { kind: "system", text: `Updated ${path}` }])
      }
    } catch {
      setNotices((prev) => [...prev, { kind: "error", text: "Failed to update SESSION_SUMMARY.md" }])
    }
  }

  const refreshSessions = () => {
    setSessionMeta(currentSessionMeta())
    setSessionRevision((v) => v + 1)
  }

  const doSwitchSession = (id: string) => {
    doSaveCurrent()
    const loaded = loadSessionState(id)
    if (loaded?.provider && loaded.model) applyProviderModel(loaded.provider, loaded.model)
    setMessages(loaded?.messages ?? [])
    setNotices([])
    setSessionId(id)
    setCurrentSessionId(id)
    refreshSessions()
    setComposerText("")
    setDraft("")
  }

  const doCreateNewSession = () => {
    doSaveCurrent()
    const meta = createSession(currentModel, currentProvider)
    setSessionId(meta.id)
    setSessionMeta(meta)
    setSessionRevision((v) => v + 1)
    setMessages([])
    setNotices([])
    setComposerText("")
    setDraft("")
  }

  const compactCurrentSession = async () => {
    const currentMessages = messages()
    const { head, tail } = selectCompactionTail(currentMessages, getModelConfig(currentModel).contextLimit)
    if (head.length === 0) {
      setStatus("session too short to compact")
      return
    }

    setPalettePendingDelete(null)
    setShowPalette(false)
    setStatus("compacting session...")

    const transcript = buildCompactionTranscript(head)
    const prompt = [
      "You are compacting a coding assistant session for future continuation.",
      "Summarize only the provided history.",
      "Produce concise bullet points.",
      "Capture these sections when present: goals, current state, files changed, code decisions, tools used, constraints, remaining work, risks, and next steps.",
      "For files changed, list concrete paths when available.",
      "For tools used, mention only meaningful tool usage that affects continuation.",
      "For remaining work, emphasize what still needs to be implemented, verified, or decided.",
      "Do not invent facts.",
      "Do not include filler prose.",
    ].join("\n")

    try {
      const result = await runSync(Effect.gen(function* () {
        const provider = yield* Provider
        return yield* provider.complete({
          model: currentModel,
          stream: false,
          max_tokens: 1200,
          temperature: 0,
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: `Summarize this earlier session history for compaction:\n\n${transcript}` },
          ],
        })
      }))

      const summary = result.message.content?.trim()
      if (!summary) {
        setStatus("compaction failed")
        return
      }

      const compacted = [createCompactSummaryMessage(summary), ...tail]
      setMessages(compacted)
      saveSession(sessionId(), compacted, currentModel, currentProvider)
      refreshSessions()
      setStatus("session compacted")
    } catch {
      setStatus("compaction failed")
    }
  }

  const submit = async () => {
    if (running()) return
    if (autocompleteApi?.visible()) {
      autocompleteApi.select()
      return
    }
    const input = draft().trim()
    if (!input) return
    if (isTransientPasteMarker(input)) {
      setComposerText("")
      return
    }

    if (input.startsWith("/")) {
      const ctx: CommandContext = {
        currentProvider,
        setCurrentProvider: async (id) => {
          const provider = PROVIDERS[id]
          if (!provider) return { ok: false, message: `Unknown provider: ${id}` }
          const models = await ensureModelsForProvider(id)
          const fallbackModel = defaultModelForCurrentProvider(id)
          const nextModel = models.includes(currentModel)
            ? currentModel
            : models[0] ?? fallbackModel
          if (!nextModel) return { ok: false, message: `No models available for provider: ${id}` }
          if (!applyProviderModel(id, nextModel, true)) return { ok: false, message: `Failed to switch provider: ${id}` }
          return { ok: true, message: `Provider switched to ${id} (${nextModel})` }
        },
        currentProviderKeyName: (providerId) => getActiveConfiguredProviderKeyName(providerId ?? currentProvider),
        listProviderKeys: (providerId) => listConfiguredProviderKeys(providerId),
        getProviderKeyConfigPath: () => getProviderConfigPath(),
        setProviderKey: async (providerId, keyName) => {
          const result = setActiveConfiguredProviderKey(providerId, keyName)
          if (!result.ok) return result
          setProviderModels((prev) => {
            const next = { ...prev }
            delete next[providerId]
            return next
          })
          setProviderModelsError((prev) => {
            const next = { ...prev }
            delete next[providerId]
            return next
          })
          if (providerId === currentProvider) {
            rebuildLayer()
          }
          return result
        },
        currentModel,
        setCurrentModel: async (name) => {
          const slash = name.indexOf("/")
          const providerId = slash > 0 ? name.slice(0, slash) : currentProvider
          const modelId = slash > 0 ? name.slice(slash + 1) : name
          const provider = PROVIDERS[providerId]
          if (!provider) return { ok: false, message: `Unknown provider: ${providerId}` }
          const models = await ensureModelsForProvider(providerId)
          if (models.length > 0 && !models.includes(modelId)) {
            return { ok: false, message: `Model not found for ${providerId}: ${modelId}` }
          }
          if (!applyProviderModel(providerId, modelId, true)) return { ok: false, message: `Failed to switch model: ${providerId}/${modelId}` }
          return { ok: true, message: `Model switched to ${providerId}/${modelId}` }
        },
        mode: mode(),
        setMode,
        messages,
        setMessages,
        setDraft: setComposerText,
        setNotices,
        exitApp,
        scrollBottom,
        switchSession: doSwitchSession,
        createNewSession: doCreateNewSession,
        currentSessionId: sessionId,
        openProviderList: () => {
          setShowPalette(true)
          setPalettePendingDelete(null)
          setPaletteMode("providers")
          setPaletteIndex(firstSelectablePaletteIndex(providerPaletteItems()))
        },
        openModelList: () => {
          setShowPalette(true)
          openModelsPalette(currentProvider, "actions")
        },
        openSessionList: () => {
          setShowPalette(true)
          setPalettePendingDelete(null)
          setPaletteMode("sessions")
          setPaletteIndex(0)
        },
        refreshSessions,
      }
      await executeCommand(input, ctx)
      if (input !== "/exit" && input !== "/quit") {
        setComposerText("")
        queueMicrotask(scrollBottom)
      }
      return
    }

    history = [input, ...history.filter((item) => item !== input)].slice(0, 100)
    historyIndex = -1
    historyDraft = ""

    queueMicrotask(scrollBottom)

    runAbort = new AbortController()
    streamState.reset()
    refreshWorkspaceMemory()
    setRunning(true)
    setStatus("thinking...")

    try {
      const next = await runSession(input, messages(), {
        abort: runAbort.signal,
        streamReasoningChunk: (text) => streamState.streamReasoningChunk(text),
        streamAssistantChunk: (text) => streamState.streamAssistantChunk(text),
        addMessage: (msg) => {
          if (msg.role === "assistant") streamState.reset()
          setMessages((prev) => [...prev, msg])
        },
        notify: (text, kind) => {
          setNotices((prev) => [...prev, { kind: kind as DisplayBlock["kind"], text }])
        },
        setStatus,
        scrollBottom,
        model: currentModel,
        mode: mode(),
      }, {
        runSync,
        systemPrompt,
        parseJson: tryParseJSON,
      })

      setMessages(next)
      saveSession(sessionId(), next, currentModel, currentProvider)
      await generateSessionSummary(next)
      setComposerText("")
      setStatus("waiting for input")
      queueMicrotask(scrollBottom)
    } finally {
      runAbort = undefined
      setRunning(false)
    }
  }

  useKeyboard((event) => {
    if (event.ctrl && event.name === "c") {
      void exitApp(0)
      event.preventDefault()
      return
    }
    if (event.ctrl && event.name === "p") {
      setShowPalette((open) => !open)
      setPalettePendingDelete(null)
      setPaletteMode("actions")
      setPaletteIndex(firstSelectablePaletteIndex(actionPaletteItems()))
      event.preventDefault()
      return
    }
    if (showPalette()) {
      if (paletteMode() === "rename" || paletteMode() === "models") {
        if (event.name === "escape") {
          if (paletteMode() === "rename") {
            setPalettePendingDelete(null)
            setPaletteMode("actions")
            setPaletteIndex(firstSelectablePaletteIndex(actionPaletteItems()))
          } else {
            const backMode = paletteModelBackMode()
            setPaletteInput("")
            setPaletteMode(backMode)
            setPaletteIndex(firstSelectablePaletteIndex(backMode === "providers" ? providerPaletteItems() : actionPaletteItems()))
          }
        } else if (event.name === "return") {
          if (paletteMode() === "rename") {
            const sid = sessionId()
            updateSessionMeta(sid, { title: paletteInput() })
            refreshSessions()
            setShowPalette(false)
            setPaletteMode("actions")
          } else {
            const item = paletteItems()[paletteIndex()]
            if (isSelectablePaletteItem(item)) item?.onSelect()
          }
        } else if (event.name === "backspace") {
          setPaletteInput(prev => prev.slice(0, -1))
        } else if (event.name === "space") {
          setPaletteInput(prev => prev + " ")
        } else if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
          setPaletteInput(prev => prev + event.name)
        }
        event.preventDefault()
        return
      }
      if (paletteMode() === "sessions" && event.ctrl && event.name === "d") {
        const item = paletteItems()[paletteIndex()]
        const targetId = item?.sessionId
        if (!targetId) {
          setComposerText("")
          event.preventDefault()
          return
        }
        if (targetId === sessionId()) {
          setStatus("cannot delete current session")
          setComposerText("")
          event.preventDefault()
          return
        }
        if (palettePendingDelete() === targetId) {
          const ok = deleteSession(targetId)
          setPalettePendingDelete(null)
          if (ok) {
            setStatus(`deleted session ${targetId}`)
            refreshSessions()
            const items = sessionPaletteItems()
            setPaletteIndex(Math.min(paletteIndex(), Math.max(0, items.length - 1)))
          }
          setComposerText("")
          event.preventDefault()
          return
        }
        setPalettePendingDelete(targetId)
        setStatus(`press ctrl+d again to delete ${targetId}`)
        setComposerText("")
        event.preventDefault()
        return
      }
      if (event.name === "escape") {
        if (paletteMode() === "sessions" || paletteMode() === "providers") {
          setPalettePendingDelete(null)
          setPaletteMode("actions")
          setPaletteIndex(firstSelectablePaletteIndex(actionPaletteItems()))
        } else if (paletteMode() === "models") {
          const backMode = paletteModelBackMode()
          setPaletteInput("")
          setPaletteMode(backMode)
          setPaletteIndex(firstSelectablePaletteIndex(backMode === "providers" ? providerPaletteItems() : actionPaletteItems()))
        } else {
            setShowPalette(false)
          }
        event.preventDefault()
        return
      }
      if (event.name === "up") {
        movePaletteIndex(-1)
        event.preventDefault()
        return
      }
      if (event.name === "down") {
        movePaletteIndex(1)
        event.preventDefault()
        return
      }
      if (event.name === "return") {
        const item = paletteItems()[paletteIndex()]
        if (isSelectablePaletteItem(item)) item?.onSelect()
        event.preventDefault()
        return
      }
      event.preventDefault()
      return
    }
    if (event.name === "escape") {
      if (autocompleteApi?.visible()) {
        setComposerText("")
        event.preventDefault()
        return
      }
      if (draft()) {
        historyIndex = -1
        historyDraft = ""
        setComposerText("")
        event.preventDefault()
        return
      }
      if (running() && runAbort) {
        runAbort.abort()
        setStatus("interrupted")
        event.preventDefault()
        return
      }
    }
    if (event.name === "tab" && autocompleteApi?.visible()) {
      autocompleteApi.select()
      event.preventDefault()
      return
    }
    if (composer && !running() && event.name === "up") {
      if (autocompleteApi?.visible()) {
        autocompleteApi.move(-1)
        event.preventDefault()
        return
      }
      if (composer.cursorOffset === 0 && history.length > 0) {
        if (historyIndex === -1) historyDraft = composer.plainText
        historyIndex = Math.min(historyIndex + 1, history.length - 1)
        setComposerText(history[historyIndex] ?? "")
        event.preventDefault()
        return
      }
    }
    if (composer && !running() && event.name === "down") {
      if (autocompleteApi?.visible()) {
        autocompleteApi.move(1)
        event.preventDefault()
        return
      }
      if (historyIndex >= 0 && composer.cursorOffset === composer.plainText.length) {
        historyIndex--
        setComposerText(historyIndex >= 0 ? (history[historyIndex] ?? "") : historyDraft)
        event.preventDefault()
        return
      }
    }
    if (!scroll) return
    if (event.name === "pageup") {
      scroll.scrollBy(-Math.max(4, Math.floor(responseHeight() / 2)))
      event.preventDefault()
      return
    }
    if (event.name === "pagedown") {
      scroll.scrollBy(Math.max(4, Math.floor(responseHeight() / 2)))
      event.preventDefault()
      return
    }
    if (event.ctrl && event.name === "b") {
      scroll.scrollBy(-Math.max(4, Math.floor(responseHeight() / 2)))
      event.preventDefault()
      return
    }
    if (event.ctrl && event.name === "f") {
      scroll.scrollBy(Math.max(4, Math.floor(responseHeight() / 2)))
      event.preventDefault()
      return
    }
    if (event.name === "home") {
      scroll.scrollTo(0)
      event.preventDefault()
      return
    }
    if (event.name === "end") {
      scroll.scrollTo(scroll.scrollHeight)
      event.preventDefault()
    }
  })

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={THEME.background}
      onMouseUp={() => {
        void copySelection()
      }}
    >
<box flexDirection="row" flexGrow={1} minHeight={0}>
      <box flexDirection="column" flexGrow={1} minHeight={0}>
      <scrollbox
        ref={(node) => {
          scroll = node
          node.verticalScrollBar.visible = false
        }}
        flexGrow={1}
        minHeight={0}
        stickyScroll={true}
        stickyStart="bottom"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        scrollY={true}
      >
        <For each={turns()}>
          {(turn, index) => <TurnEntry turn={turn} isFirst={index() === 0} />}
        </For>
      </scrollbox>

      <box flexShrink={0} flexDirection="column" border={["left"]} borderColor={THEME.border}>
        <box backgroundColor={THEME.surface} paddingLeft={2} paddingRight={2} paddingTop={1}>
            <box flexDirection="column">
              <textarea
                placeholder="Ask anything..."
                placeholderColor={THEME.muted}
                textColor={THEME.text}
                focusedTextColor={THEME.text}
                focusedBackgroundColor={THEME.surface}
                backgroundColor={THEME.surface}
                cursorColor={THEME.text}
                keyBindings={PROMPT_KEY_BINDINGS}
                minHeight={1}
                maxHeight={6}
                width="100%"
                focused={!showPalette()}
                ref={(node) => {
                  composer = node
                }}
                onContentChange={() => setDraft(composer?.plainText ?? "")}
                onSubmit={() => { void submit() }}
              />
            </box>
            <box paddingTop={1} paddingBottom={1} flexDirection="row">
              <text style={{ fg: mode() === "build" ? "#58a6ff" : "#3fb950" }}>
                {mode() === "build" ? "Build" : "Plan"}
              </text>
              <text style={{ fg: THEME.muted }}>{"  •  "}</text>
              <text style={{ fg: THEME.text }}>{truncateText(modelLabel(), 32)}</text>
              <Show when={running()} fallback={
                <text style={{ fg: THEME.muted }}>{`  •  ${SCROLL_HINT}`}</text>
              }>
                <box flexDirection="row">
                  <text style={{ fg: THEME.accent }}>{`  ${SPINNER_FRAMES[spinnerFrame()]}  `}</text>
                  <text style={{ fg: THEME.muted }}>{`${status()}  •  `}</text>
                  <text style={{ fg: "#f85149" }}>Esc interrupt</text>
                </box>
              </Show>
            </box>
          </box>
        <box height={1} border={["left"]} borderColor={THEME.border}>
          <box width="100%" border={["bottom"]} borderColor={THEME.surface} />
        </box>
      </box>
      </box>

      <Sidebar
        messages={messages}
        theme={THEME}
        width={SIDEBAR_WIDTH}
        provider={providerLabel()}
        model={modelLabel()}
        sessionTitle={sessionMeta()?.title}
      />
      </box>

      <SlashAutocomplete
        commands={BUILTIN_COMMANDS}
        draft={draft}
        ref={(api) => { autocompleteApi = api }}
        onCommand={(name) => {
          const noArgs = new Set(["help", "clear", "info", "exit", "quit"])
          if (noArgs.has(name)) {
            setComposerText("/" + name)
            queueMicrotask(() => { void submit() })
          } else {
            setComposerText("/" + name + " ")
          }
        }}
        onHide={() => {}}
        bottom={8}
        left={3}
        width={dimensions().width - 8}
      />

      <Show when={showPalette()}>
        <box
          position="absolute"
          top={Math.floor((dimensions().height - (paletteMode() === "rename" ? 7 : paletteItems().length + 6)) / 2)}
          left={Math.floor((dimensions().width - 2 - 52) / 2)}
          width={PALETTE_WIDTH}
          zIndex={100}
          backgroundColor={THEME.surface}
          border={["top", "left", "right", "bottom"]}
          borderColor={THEME.accent}
          flexDirection="column"
        >
          <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
            <text style={{ fg: THEME.accent }}>
              {paletteMode() === "rename"
                ? "Rename Session"
                : paletteMode() === "sessions"
                  ? "Switch Session"
                  : paletteMode() === "providers"
                    ? "Switch Provider"
                    : paletteMode() === "models"
                      ? `Switch Model · ${paletteProviderTarget()}`
                      : paletteMode() === "providerKeyProviders"
                        ? "Provider Keys"
                        : paletteMode() === "providerKeys"
                          ? `Provider Keys · ${paletteProviderKeyTarget()}`
                      : "Command Palette"}
            </text>
            <text style={{ fg: THEME.muted }}>  Ctrl+P</text>
          </box>
          <box border={["top"]} borderColor={THEME.border} flexDirection="column">
            <Show when={paletteMode() === "rename" || paletteMode() === "models"}>
              <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column" gap={1}>
                <text style={{ fg: THEME.muted }}>
                  {paletteMode() === "rename" ? "Enter new name:" : "Filter models:"}
                </text>
                <box
                  backgroundColor={THEME.background}
                  border={["left", "right"]}
                  borderColor={THEME.border}
                  paddingLeft={1}
                  paddingRight={1}
                  flexDirection="row"
                >
                  <text style={{ fg: THEME.text }}>{paletteInput()}</text>
                  <text style={{ fg: THEME.accent }}>▌</text>
                </box>
              </box>
            </Show>
            <Show when={paletteMode() !== "rename"}>
              <For each={paletteItems()}>
                {(item, index) => (
                  <box
                    paddingLeft={2}
                    paddingRight={2}
                    paddingTop={0}
                    paddingBottom={0}
                    backgroundColor={item.kind !== "section"
                      ? item.sessionId && palettePendingDelete() === item.sessionId
                        ? "#3d1717"
                        : index() === paletteIndex()
                          ? THEME.accentDim
                          : undefined
                      : undefined}
                    onMouseMove={() => {
                      if (item.kind !== "section") setPaletteIndex(index())
                    }}
                    onMouseDown={() => {
                      if (item.kind === "section") return
                      setPaletteIndex(index())
                      item.onSelect()
                    }}
                    flexDirection="row"
                    gap={2}
                  >
                    <text style={{ fg: item.kind === "section" ? THEME.accent : item.sessionId && palettePendingDelete() === item.sessionId ? "#ffb3b3" : index() === paletteIndex() ? "#ffffff" : THEME.text }}>
                      {truncateText(item.label, PALETTE_LABEL_MAX)}
                    </text>
                    <Show when={item.hint && item.kind !== "section"}>
                      <text
                        style={{ fg: item.sessionId && palettePendingDelete() === item.sessionId ? "#ffb3b3" : index() === paletteIndex() ? THEME.border : THEME.muted }}
                        wrapMode="none"
                      >
                        {truncateText(item.sessionId && palettePendingDelete() === item.sessionId ? "Ctrl+D again" : item.hint ?? "", PALETTE_HINT_MAX)}
                      </text>
                    </Show>
                  </box>
                )}
              </For>
            </Show>
          </box>
          <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} border={["top"]} borderColor={THEME.border}>
            <text style={{ fg: THEME.muted }}>
              {paletteMode() === "rename"
                ? "Enter confirm  •  Esc cancel"
                  : paletteMode() === "sessions"
                  ? "↑↓ navigate  •  Enter select  •  Ctrl+D delete  •  Esc back"
                  : paletteMode() === "models"
                    ? "Type to filter  •  ↑↓ navigate  •  Enter select  •  Esc back"
                    : paletteMode() === "providers"
                      ? "↑↓ navigate  •  Enter select  •  Esc back"
                    : "↑↓ navigate  •  Enter select  •  Esc close"}
            </text>
          </box>
        </box>
      </Show>

    </box>
  )
}

render(() => <App />).catch((error) => {
  console.error(error)
  process.exit(1)
})
