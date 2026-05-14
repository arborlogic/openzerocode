import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { ScrollBoxRenderable, TextareaRenderable, KeyBinding } from "@opentui/core"
import { SyntaxStyle } from "@opentui/core"
import { Effect, Layer } from "effect"
import { spawn } from "node:child_process"
import { platform } from "os"
import { buildLayer, autoDetectProvider, defaultModelForProvider, PROVIDERS, normalizeBigPickleModel } from "../provider/index"
import { layer as toolLayer } from "../tool/registry"
import { ToolRegistry } from "../tool/registry"
import { Provider } from "../provider/types"
import type { Message } from "../provider/types"
import type { PermissionRequest } from "../tool/types"
import { createStreamState } from "./stream-state"
import { runSession, type RunMode } from "./session-runner"
import { SlashAutocomplete } from "./autocomplete"
import type { AutocompleteApi } from "./autocomplete"
import { BUILTIN_COMMANDS, executeCommand, type CommandContext } from "./commands"
import { Sidebar } from "./sidebar"
import { createSession, deleteSession, getCurrentSessionId, loadSessionState, saveSession, setCurrentSessionId, currentSessionMeta, listSessions, updateSessionMeta, markSessionActive, unmarkSessionActive, isSessionActive, getSessionActiveInfo, type CompactionInfo } from "./sessions"
import { getKnownModelConfig, getModelConfig, estimateTokens } from "../provider/models"
import { buildCompactionTranscript, selectCompactionTail, stripCompactSummaryMessages } from "./session-compact"
import { loadAgentsInstruction } from "./workspace-memory"
import { getActiveConfiguredProviderKeyName, getProviderConfigPath, listConfiguredProviderKeys, setActiveConfiguredProviderKey, addConfiguredProviderKey, removeConfiguredProviderKey, readProviderConfig, writeProviderConfig, getStoredProviderConfig } from "../provider/config"
import { buildSystemPrompt } from "./system-prompt"
import { addPermissionRules, shouldAutoApprove, isDangerousBashCommand, type PermissionRule } from "./permission-rules"
import { sanitizeMessages } from "./message-sanitize"
import { SplashScreen } from "./splash"
import { loadUIPrefs, saveUIPrefs } from "./ui-prefs"

// Version — injected at build time via scripts/build.ts, fallback to dev import
const VERSION: string =
  (typeof process !== "undefined" && (process.env as Record<string, string>)["__OPENZEROCODE_VERSION__"]) ||
  "0.0.0-dev"

// Handle CLI flags before anything else
const args = process.argv.slice(2)
if (args.includes("--version") || args.includes("-v")) {
  console.log(`openzerocode v${VERSION}`)
  process.exit(0)
}
if (args.includes("--help") || args.includes("-h")) {
  console.log(`openzerocode v${VERSION}`)
  console.log()
  console.log("Usage: openzerocode [options] [prompt...]")
  console.log()
  console.log("Options:")
  console.log("  -v, --version            Show version number")
  console.log("  -h, --help               Show this help message")
  console.log()
  console.log("If a prompt is provided as arguments, it runs in non-interactive mode.")
  console.log("Otherwise, the terminal UI is launched.")
  process.exit(0)
}

let currentProvider = autoDetectProvider() ?? "opencode-zen"
let currentModel = normalizeBigPickleModel(process.env.OPENZERO_MODEL ?? defaultModelForProvider(currentProvider))
let currentLayer = Layer.merge(buildLayer(currentProvider, currentModel), toolLayer)
let agentsInstruction = loadAgentsInstruction(process.cwd())

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
const MARKDOWN_SYNTAX = SyntaxStyle.fromTheme([
  { scope: ["default"], style: { foreground: THEME.text } },
  { scope: ["comment"], style: { foreground: THEME.muted, italic: true } },
  { scope: ["string"], style: { foreground: "#a5d6ff" } },
  { scope: ["keyword"], style: { foreground: THEME.accent, bold: true } },
  { scope: ["number"], style: { foreground: "#79c0ff" } },
  { scope: ["function"], style: { foreground: "#d2a8ff" } },
  { scope: ["type"], style: { foreground: "#ffa657" } },
])
// Register a paste-marker style for extmarks (orange badge like opencode)
MARKDOWN_SYNTAX.registerStyle("paste", {
  fg: THEME.background,
  bg: THEME.warning,
  bold: true,
})

const EMPTY_STATE_MESSAGE = "Response scroll is locked inside the panel. Mouse wheel scrolls response only."
const SCROLL_HINT = "Enter submit  •  Shift/Ctrl/Alt+Enter newline  •  / commands  •  Ctrl+P / F2 palette"
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
  streaming?: boolean
}

type DisplayTurn = {
  user?: DisplayBlock
  entries: DisplayBlock[]
  footer?: string
  userMsgIndex?: number  // index into messages() so we can edit/truncate
}

function rebuildLayer() {
  currentLayer = Layer.merge(buildLayer(currentProvider, currentModel), toolLayer)
}

function defaultModelForCurrentProvider(providerId: string) {
  const configured = process.env.OPENZERO_MODEL ?? defaultModelForProvider(providerId)
  return providerId === "opencode-zen" ? normalizeBigPickleModel(configured) : configured
}

function runSync<E, A>(effect: Effect.Effect<A, E, ToolRegistry | Provider>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(currentLayer)))
}

function tryParseJSON(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) } catch { return {} }
}

/** Format a tool-call input for compact one-line display */
function formatToolCallInput(tool: string, input: string): string {
  const parsed = tryParseJSON(input)
  if (tool === "bash" && typeof parsed.command === "string") {
    return `$ ${parsed.command}`
  }
  if (tool === "read_file" && typeof parsed.filePath === "string") {
    return parsed.filePath
  }
  if (tool === "write" && typeof parsed.filePath === "string") {
    const contentLen = typeof parsed.content === "string" ? parsed.content.length : 0
    return `${parsed.filePath}  (${contentLen} chars)`
  }
  if (tool === "glob" && typeof parsed.pattern === "string") {
    return parsed.pattern
  }
  if (tool === "web_fetch" && typeof parsed.url === "string") {
    return parsed.url
  }
  // Fallback: first line of input, truncated
  const firstLine = input.split("\n")[0] ?? ""
  return firstLine.length > 80 ? firstLine.slice(0, 77) + "…" : firstLine
}

/** Format a tool result for compact one-line preview */
function formatToolResultPreview(text: string): string {
  const lines = text.split("\n")
  if (lines.length === 0) return ""
  if (lines.length === 1 && lines[0]!.length <= 120) return lines[0]!
  const firstLine = lines[0]!
  const preview = firstLine.length > 100 ? firstLine.slice(0, 97) + "…" : firstLine
  return `${preview}  (${lines.length} lines)`
}

function stripAnsi(str: string) {
  return str.replace(/\x1b\[[0-9;]*m/g, "")
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
  return /^\[Pasted ~\d+ lines(?: #\d+)?\]/.test(input.trim())
}

function maskKey(value: string): string {
  if (value.length <= 8) return value.slice(0, 1) + "***" + value.slice(-1)
  const prefix = value.slice(0, 5)
  const suffix = value.slice(-3)
  return `${prefix}***${suffix}`
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
  return buildSystemPrompt(mode, agentsInstruction)
}

function refreshAgentsInstruction() {
  agentsInstruction = loadAgentsInstruction(process.cwd())
}

function messageToBlocks(msg: Message): DisplayBlock[] {
  if (msg.parts && msg.parts.length > 0) {
    return msg.parts.map((part): DisplayBlock => {
        switch (part.type) {
          case "text":
            return { kind: "assistant", text: part.text }
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
      if (msg.content) result.push({ kind: "assistant", text: msg.content })
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
  const [collapsed, setCollapsed] = createSignal(
    collapsible() && !(props.entry.streaming ?? false)
  )

  const labelColor = () => props.entry.kind === "user" ? THEME.user
    : props.entry.kind === "reasoning" ? THEME.accent
    : props.entry.kind === "tool" || props.entry.kind === "tool-call" ? THEME.tool
    : props.entry.kind === "error" ? THEME.error
    : THEME.muted

  const textColor = () => props.entry.kind === "reasoning" || props.entry.kind === "system" ? THEME.muted : THEME.text

  const collapsedPreview = () => {
    if (props.entry.kind === "tool-call" && props.entry.title) {
      return formatToolCallInput(props.entry.title, props.entry.text)
    }
    if (props.entry.kind === "tool") {
      return formatToolResultPreview(props.entry.text)
    }
    return ""
  }

  if (props.entry.kind === "assistant") {
    return (
      <box marginTop={props.isFirst ? 0 : 1}>
        <Show
          when={!props.entry.streaming}
          fallback={<text style={{ fg: THEME.text }}>{props.entry.text}</text>}
        >
          <markdown
            content={props.entry.text}
            syntaxStyle={MARKDOWN_SYNTAX}
            fg={THEME.text}
            bg={THEME.background}
            streaming={false}
          />
        </Show>
      </box>
    )
  }

  if (props.entry.kind === "system") {
    return (
      <box marginTop={props.isFirst ? 0 : 1}>
        <text style={{ fg: textColor() }}>{props.entry.text}</text>
      </box>
    )
  }

  if (props.entry.kind === "reasoning") {
    return (
      <box marginTop={props.isFirst ? 0 : 1} flexDirection="column" gap={1}>
        {/* Thinking header — always shown, click to toggle */}
        <box
          flexDirection="row"
          gap={1}
          onMouseDown={() => setCollapsed(c => !c)}
        >
          <text style={{ fg: labelColor() }}>{collapsed() ? "▸" : "▾"}</text>
          <text style={{ fg: labelColor() }}>Thinking</text>
          <Show when={props.entry.streaming}>
            <text style={{ fg: THEME.muted }}> …</text>
          </Show>
          <Show when={collapsed() && !props.entry.streaming}>
            <text style={{ fg: THEME.muted }}>· {props.entry.text.split("\n")[0]}</text>
          </Show>
        </box>
        {/* Body — hidden when collapsed */}
        <Show when={!collapsed()}>
          <text style={{ fg: THEME.muted }}>{props.entry.text}</text>
        </Show>
      </box>
    )
  }

  /* tool-call and tool entries */
  const isBashCall = props.entry.kind === "tool-call" && props.entry.title === "bash"
  const toolIcon = props.entry.kind === "tool" ? "✓" : props.entry.kind === "error" ? "✗" : "■"
  const toolLabel = props.entry.title ?? (props.entry.kind === "tool" ? "result" : "tool")

  return (
    <box marginTop={props.isFirst ? 0 : 1} flexDirection="column" gap={1}>
      {/* Header row */}
      <box
        flexDirection="row"
        gap={1}
        onMouseDown={() => collapsible() && setCollapsed(c => !c)}
      >
        <Show when={collapsible()}>
          <text style={{ fg: labelColor() }}>{collapsed() ? "▸" : "▾"}</text>
        </Show>
        <text style={{ fg: labelColor() }}>{toolIcon}</text>
        <text style={{ fg: labelColor() }}>{toolLabel}</text>
        <Show when={props.entry.streaming}>
          <text style={{ fg: THEME.muted }}> …</text>
        </Show>
        <Show when={collapsed() && collapsedPreview()}>
          <text style={{ fg: THEME.muted }}>· {collapsedPreview()}</text>
        </Show>
      </box>

      {/* Expanded body */}
      <Show when={!collapsed()}>
        <box paddingLeft={2}>
          <Show when={isBashCall && !props.entry.streaming}>
            <text style={{ fg: textColor() }}>
              {(() => {
                const parsed = tryParseJSON(props.entry.text)
                return typeof parsed.command === "string"
                  ? `$ ${parsed.command}`
                  : props.entry.text
              })()}
            </text>
          </Show>
          <Show when={props.entry.kind === "tool" && !props.entry.streaming}>
            <text style={{ fg: THEME.muted }}>
              {(() => {
                const lines = props.entry.text.split("\n")
                const preview = lines.slice(0, 20).join("\n")
                return lines.length > 20 ? `${preview}\n… (${lines.length - 20} more lines)` : preview
              })()}
            </text>
          </Show>
          <Show when={(props.entry.kind !== "tool" && !isBashCall) || !!props.entry.streaming}>
            <text style={{ fg: textColor() }}>{props.entry.text}</text>
          </Show>
        </box>
      </Show>
    </box>
  )
}

function TurnEntry(props: {
  turn: DisplayTurn
  isFirst: boolean
  onUserClick?: (msgIndex: number, text: string) => void
  isRunning?: boolean
}) {
  const canClick = () => !props.isRunning && props.turn.userMsgIndex !== undefined && !!props.onUserClick

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
          onMouseDown={() => {
            if (canClick()) {
              props.onUserClick!(props.turn.userMsgIndex!, props.turn.user?.text ?? "")
            }
          }}
        >
          <box flexDirection="row" gap={1}>
            <text style={{ fg: THEME.text, flexGrow: 1 }}>{props.turn.user?.text ?? ""}</text>
            <Show when={canClick()}>
              <text style={{ fg: THEME.muted }}>⋯</text>
            </Show>
          </box>
        </box>
      </Show>

      <Show when={props.turn.entries.length > 0}>
        <box flexDirection="column">
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
  let initialMode: RunMode = "build"
  let initialCompaction: CompactionInfo | undefined
  let initialPermissionRules: PermissionRule[] = []
  let initialAutoApprove = false
  let sid = getCurrentSessionId()
  if (sid) {
    const loaded = loadSessionState(sid)
    const meta = currentSessionMeta()
    if (loaded) {
      initialMessages = loaded.messages
      if (loaded.provider) currentProvider = loaded.provider
      if (loaded.model) currentModel = loaded.provider === "opencode-zen" ? normalizeBigPickleModel(loaded.model) : loaded.model
      if (loaded.mode === "plan") initialMode = "plan"
      initialCompaction = loaded.compaction
      initialPermissionRules = loaded.permissionRules ?? []
      initialAutoApprove = loaded.autoApprove ?? false
    }
    if (meta?.provider) currentProvider = meta.provider
    if (meta?.model) currentModel = meta.provider === "opencode-zen" ? normalizeBigPickleModel(meta.model) : meta.model
    try {
      rebuildLayer()
    } catch {
      currentProvider = autoDetectProvider() ?? "opencode-zen"
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
  const [mode, setMode] = createSignal<RunMode>(initialMode)
  const [compaction, setCompaction] = createSignal<CompactionInfo | undefined>(initialCompaction)
  const [copyNotice, setCopyNotice] = createSignal(false)
  let copyNoticeTimer: ReturnType<typeof setTimeout> | undefined
  const [permissionRules, setPermissionRules] = createSignal<PermissionRule[]>(initialPermissionRules)
  type PendingApproval = {
    request: PermissionRequest
    resolve: () => void
    reject: (e: Error) => void
    allowAlways: () => void
  }
  const [pendingApproval, setPendingApproval] = createSignal<PendingApproval | undefined>(undefined)
  const [showPalette, setShowPalette] = createSignal(false)
  const [paletteIndex, setPaletteIndex] = createSignal(0)
  const [paletteMode, setPaletteMode] = createSignal<"actions" | "sessions" | "rename" | "providers" | "models" | "providerKeyProviders" | "providerKeys" | "timeline" | "display" | "addProviderKeyName" | "addProviderKeyValue" | "userMessageActions">("actions")
  const [userMsgActionTarget, setUserMsgActionTarget] = createSignal<{ index: number; text: string } | null>(null)
  const [paletteInput, setPaletteInput] = createSignal("")
  const [palettePendingDelete, setPalettePendingDelete] = createSignal<string | null>(null)
  const [paletteProviderTarget, setPaletteProviderTarget] = createSignal(currentProvider)
  const [paletteModelBackMode, setPaletteModelBackMode] = createSignal<"actions" | "providers">("actions")
  const [paletteProviderKeyTarget, setPaletteProviderKeyTarget] = createSignal(currentProvider)
  const [paletteNewKeyName, setPaletteNewKeyName] = createSignal("")
  const [timelineTargetMsgIdx, setTimelineTargetMsgIdx] = createSignal(0)
  const [sessionRevision, setSessionRevision] = createSignal(0)
  const [lockPollRevision, setLockPollRevision] = createSignal(0)
  const [selectionRevision, setSelectionRevision] = createSignal(0)
  const [providerConfigRevision, setProviderConfigRevision] = createSignal(0)
  const [providerModels, setProviderModels] = createSignal<Record<string, string[]>>({})
  const [providerModelsLoading, setProviderModelsLoading] = createSignal<string | null>(null)
  const [providerModelsError, setProviderModelsError] = createSignal<Record<string, string>>({})
  const streamState = createStreamState()
  const [notices, setNotices] = createSignal<DisplayBlock[]>([])
  const _uiPrefs = loadUIPrefs()
  const [showCompletedTools, setShowCompletedTools] = createSignal(_uiPrefs.showCompletedTools)
  const [showThinkingBlocks, setShowThinkingBlocks] = createSignal(_uiPrefs.showThinkingBlocks)
const [autoApprove, setAutoApprove] = createSignal(initialAutoApprove)
  const [composerCollapsed, setComposerCollapsed] = createSignal(false)
  const [layoutMode, setLayoutMode] = createSignal<"horizontal" | "vertical">(
    _uiPrefs.layoutMode ?? (dimensions().height > dimensions().width ? "vertical" : "horizontal")
  )
  const [showSplash, setShowSplash] = createSignal(true)
  const [splashSelectedIndex, setSplashSelectedIndex] = createSignal(-1)
  const splashSessions = listSessions()
  const [sidebarCollapsed, setSidebarCollapsed] = createSignal(
    dimensions().height > dimensions().width
  )
  const pastedContent = new Map<string, string>()
  let pasteCounter = 0
  const pasteStyleId = MARKDOWN_SYNTAX.getStyleId("paste")!
  let pasteExtmarkTypeId = 0
  const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  const [spinnerFrame, setSpinnerFrame] = createSignal(0)
  createEffect(() => {
    if (!running()) return
    const id = setInterval(() => setSpinnerFrame(f => (f + 1) % SPINNER_FRAMES.length), 80)
    return () => clearInterval(id)
  })
  createEffect(() => { saveUIPrefs({ showCompletedTools: showCompletedTools() }) })
  createEffect(() => { saveUIPrefs({ showThinkingBlocks: showThinkingBlocks() }) })
  createEffect(() => { saveUIPrefs({ layoutMode: layoutMode() }) })
  // Auto-detect vertical layout when terminal is portrait-oriented
  let autoLayoutOverride = false
  createEffect(() => {
    const { width, height } = dimensions()
    if (autoLayoutOverride) return
    const shouldBeVertical = height > width
    if (shouldBeVertical && layoutMode() !== "vertical") {
      setLayoutMode("vertical")
      setSidebarCollapsed(true)
    } else if (!shouldBeVertical && layoutMode() !== "horizontal") {
      setLayoutMode("horizontal")
      setSidebarCollapsed(false)
    }
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

  // Return the correct visible items list for the current palette mode
  // (respects filtering for non-rename/non-models modes)
  const displayItems = () =>
    paletteMode() === "models" ? paletteItems() : filteredPaletteItems()

  const movePaletteIndex = (delta: -1 | 1) => {
    const items = displayItems()
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
      const nextModel = nextProvider === "opencode-zen" ? normalizeBigPickleModel(model) : model
      currentLayer = Layer.merge(buildLayer(nextProvider, nextModel), toolLayer)
      currentProvider = nextProvider
      currentModel = nextModel
      setSelectionRevision((value) => value + 1)
      if (persist) saveSession(sessionId(), messages(), currentModel, currentProvider, mode(), compaction(), permissionRules(), autoApprove())
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
      const defaultModel = defaultModelForProvider(providerId)
      const layer = Layer.merge(buildLayer(providerId, defaultModel), toolLayer)
      const models = await Effect.runPromise(
        Effect.gen(function* () {
          const provider = yield* Provider
          return yield* provider.models()
        }).pipe(Effect.provide(layer)),
      )
      const unique = [...new Set(models)].sort((a, b) => a.localeCompare(b))
      setProviderModels((prev) => ({ ...prev, [providerId]: unique.length > 0 ? unique : [defaultModel] }))
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

  const timelineMsgs = createMemo(() => {
    return messages().filter((msg) => msg.role === "user" && msg.content);
  });

  const formatTimelineHint = () => {
    const count = timelineMsgs().length;
    return count === 0 ? "empty" : String(count);
  };

  const timelinePaletteItems = createMemo<PaletteItem[]>(() => {
    selectionRevision();
    const msgs = timelineMsgs();
    const items: PaletteItem[] = [];

    if (msgs.length === 0) {
      items.push({ label: "No user messages yet", kind: "section", onSelect: () => {} });
    }

    // Newest first, cap at 50 (filter narrows further)
    const TIMELINE_MAX = 10
    const visible = [...msgs].reverse().slice(0, TIMELINE_MAX)
    const total = msgs.length

    for (let vi = 0; vi < visible.length; vi++) {
      const msg = visible[vi];
      const i = total - 1 - vi  // original index (for display numbering)
      const text = (msg.content ?? "").replace(/\n/g, " ").slice(0, 50);
      const isActive = i === timelineTargetMsgIdx();
      items.push({
        label: (isActive ? ">" : " ") + " " + text,
        hint: `msg #${i + 1}`,
        onSelect: () => {
          setTimelineTargetMsgIdx(i);
          // Open unified message actions (Revert / Copy / Fork)
          const actualIdx = messages().indexOf(msg)
          if (actualIdx >= 0) {
            setUserMsgActionTarget({ index: actualIdx, text: msg.content ?? "" })
          }
          setPaletteMode("userMessageActions");
          setPaletteIndex(0);
        },
      });
    }

    if (total > TIMELINE_MAX) {
      items.push({ label: `… ${total - TIMELINE_MAX} older messages (use filter to search)`, kind: "section", onSelect: () => {} })
    }

    items.push({ label: "", onSelect: () => {} });
    items.push({
      label: "← Back",
      onSelect: () => {
        setPaletteMode("actions");
        setPaletteIndex(firstSelectablePaletteIndex(actionPaletteItems()));
      },
    });
    return items;
  });


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
        label: "Auto-approve",
        hint: autoApprove() ? "ON" : "OFF",
        onSelect: () => { setAutoApprove(c => !c); setShowPalette(false) },
      },
      {
        label: "DISPLAY",
        kind: "section",
        onSelect: () => {},
      },
      {
        label: "Display settings",
        hint: "tools, thinking, layout …",
        onSelect: () => {
          setPalettePendingDelete(null)
          setPaletteMode("display")
          setPaletteIndex(0)
        },
      },
      {
        label: "Reload config",
        hint: "config files only (not source code)",
        onSelect: () => {
          refreshAgentsInstruction()
          // Re-detect provider in case API keys changed
          const detected = autoDetectProvider()
          if (detected && detected !== currentProvider) {
            currentProvider = detected
            currentModel = defaultModelForCurrentProvider(currentProvider)
          } else {
            // Re-normalize model in case API key status changed
            currentModel = normalizeBigPickleModel(currentModel)
          }
          rebuildLayer()
          setProviderModels({})
          setProviderModelsError({})
          setProviderConfigRevision(v => v + 1)
          setSelectionRevision(v => v + 1)
          setStatus("config reloaded")
          setShowPalette(false)
        },
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
        label: "Timeline",
        hint: formatTimelineHint(),
        onSelect: () => {
          setPalettePendingDelete(null);
          setTimelineTargetMsgIdx(0);
          setPaletteMode("timeline");
          setPaletteIndex(0);
        },
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
    ]
  })

  const sessionPaletteItems = createMemo<PaletteItem[]>(() => {
    sessionRevision()
    lockPollRevision()
    const sid = sessionId()
    const sessions = listSessions()
    const items: PaletteItem[] = []

    for (const s of sessions) {
      const isCurrent = s.id === sid
      const active = isSessionActive(s.id)
      const ownActive = active ? getSessionActiveInfo(s.id)?.pid === process.pid : false
      const prefix = isCurrent ? ">" : active ? (ownActive ? "~" : "⚡") : " "
      const activeHint = active
        ? ownActive ? "active" : "in use"
        : String(s.messageCount)
      items.push({
        label: `${prefix} ${s.title.slice(0, 28)}`,
        hint: activeHint,
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
      onSelect: () => {
        const keys = listConfiguredProviderKeys(provider.id)
        if (keys.length === 0) {
          openModelsPalette(provider.id, "providers")
        } else {
          openProviderKeyPalette(provider.id)
        }
      },
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

  const providerKeyPaletteItems = createMemo<PaletteItem[]>(() => {
    providerConfigRevision()
    const providerId = paletteProviderKeyTarget()
    const active = getActiveConfiguredProviderKeyName(providerId)
    const keys = listConfiguredProviderKeys(providerId)
    const items: PaletteItem[] = []

    items.push({
      label: `Keys for ${providerId}`,
      kind: "section",
      onSelect: () => {},
    })

    for (const key of keys) {
      const cfg = getStoredProviderConfig(providerId)
      const rawValue = cfg?.keys?.[key] ?? ""
      const masked = maskKey(rawValue)
      items.push({
        label: `${key === active ? ">" : " "} ${key}`,
        hint: masked,
        sessionId: key,
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
          openModelsPalette(providerId, "providers")
        },
      })
    }

    items.push({ label: "", onSelect: () => {} })
    items.push({
      label: "Add key...",
      onSelect: () => {
        setPaletteNewKeyName("")
        setPaletteInput("")
        setPaletteMode("addProviderKeyName")
        setPaletteIndex(0)
      },
    })
    items.push({ label: "", onSelect: () => {} })
    items.push({
      label: "← Back",
      onSelect: () => {
        setPaletteMode("providers")
        setPaletteIndex(firstSelectablePaletteIndex(providerPaletteItems()))
      },
    })
    return items
  })

  const displayPaletteItems = createMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      {
        label: "DISPLAY SETTINGS",
        kind: "section",
        onSelect: () => {},
      },
      {
        label: "Completed tools",
        hint: showCompletedTools() ? "shown" : "hidden",
        onSelect: () => { setShowCompletedTools(c => !c); setShowPalette(false) },
      },
      {
        label: "Thinking blocks",
        hint: showThinkingBlocks() ? "shown" : "hidden",
        onSelect: () => { setShowThinkingBlocks(c => !c); setShowPalette(false) },
      },
      {
        label: "Layout mode",
        hint: layoutMode() === "horizontal" ? "horizontal" : "vertical",
        onSelect: () => {
          autoLayoutOverride = true
          setLayoutMode(m => m === "horizontal" ? "vertical" : "horizontal")
          if (layoutMode() === "vertical") setSidebarCollapsed(true)
          setShowPalette(false)
        },
      },
      { label: "", onSelect: () => {} },
      {
        label: "← Back",
        onSelect: () => {
          setPaletteMode("actions")
          setPaletteIndex(firstSelectablePaletteIndex(actionPaletteItems()))
        },
      },
    ]
    return items
  })

  
  const userMessageActionItems = createMemo<PaletteItem[]>(() => {
    const target = userMsgActionTarget()
    return [
      {
        label: "Revert",
        hint: "undo messages and file changes",
        onSelect: () => {
          if (target) doEditUserMessage(target.index, target.text)
          setShowPalette(false)
          setPaletteMode("actions")
        },
      },
      {
        label: "Copy",
        hint: "message text to clipboard",
        onSelect: async () => {
          if (target) await copyToClipboard(target.text)
          setShowPalette(false)
          setPaletteMode("actions")
        },
      },
      {
        label: "Fork",
        hint: "create new session from here",
        onSelect: () => {
          if (target) doForkFromMessageIndex(target.index)
          setShowPalette(false)
          setPaletteMode("actions")
        },
      },
    ]
  })

  const paletteItems = createMemo<PaletteItem[]>(() =>
    paletteMode() === "sessions"
      ? sessionPaletteItems()
      : paletteMode() === "providers"
        ? providerPaletteItems()
        : paletteMode() === "models"
          ? modelPaletteItems()
          : paletteMode() === "providerKeys"
            ? providerKeyPaletteItems()
          : paletteMode() === "timeline"
            ? timelinePaletteItems()
          : paletteMode() === "display"
            ? displayPaletteItems()
          : paletteMode() === "userMessageActions"
            ? userMessageActionItems()
          : actionPaletteItems(),
  )

  const filteredPaletteItems = createMemo<PaletteItem[]>(() => {
    const items = paletteItems()
    // rename mode: paletteInput is the name text, not a filter
    // models mode: handles its own filtering internally
    if (paletteMode() === "rename" || paletteMode() === "models" || paletteMode() === "addProviderKeyName" || paletteMode() === "addProviderKeyValue") return items
    const filter = paletteInput().trim().toLowerCase()
    if (!filter) return items
    return items.filter((item) => {
      if (item.kind === "section") return true
      if (item.label.toLowerCase().includes(filter)) return true
      if (item.hint && item.hint.toLowerCase().includes(filter)) return true
      return false
    })
  })

  // Reset filter when switching to modes that need a clean state
  createEffect(() => {
    const mode = paletteMode()
    if (mode !== "rename" && mode !== "models" && mode !== "addProviderKeyName" && mode !== "addProviderKeyValue") {
      setPaletteInput("")
    }
  })

  // Keep palette index valid when filter narrows the visible items
  createEffect(() => {
    if (paletteMode() === "rename" || paletteMode() === "models" || paletteMode() === "addProviderKeyName" || paletteMode() === "addProviderKeyValue") return
    paletteInput() // depend on filter text
    const items = displayItems()
    const idx = paletteIndex()
    if (items.length === 0) return
    if (idx >= items.length || !isSelectablePaletteItem(items[idx])) {
      setPaletteIndex(firstSelectablePaletteIndex(items))
    }
  })

  createEffect(() => {
    if (!showPalette()) return
    if (paletteMode() !== "models") return
    paletteInput()
    setPaletteIndex(firstSelectablePaletteIndex(paletteItems()))
  })

  // Poll lock status while session list palette is open
  createEffect(() => {
    if (!showPalette()) return
    if (paletteMode() !== "sessions") return
    const id = setInterval(() => setLockPollRevision(v => v + 1), 2000)
    return () => clearInterval(id)
  })

  const turns = createMemo(() => {
    selectionRevision()
    const result: DisplayTurn[] = []
    const assistantFooter = () => `${providerLabel()}/${modelLabel()}  •  select text to copy`
    const footerText = () => `${truncateText(providerLabel(), 12)}/${truncateText(modelLabel(), 28)}  •  select text to copy`
    let hiddenToolCount = 0
    const hiddenToolNames = new Set<string>()

    const shouldShowEntry = (entry: DisplayBlock): boolean => {
      // Always show streaming entries
      if (entry.streaming) return true
      // Always show user, assistant, system, error
      if (entry.kind === "user" || entry.kind === "assistant" || entry.kind === "system" || entry.kind === "error") return true
      // Hide completed tool-call and tool entries when showCompletedTools is off
      if ((entry.kind === "tool-call" || entry.kind === "tool") && !showCompletedTools()) {
        if (entry.title) hiddenToolNames.add(entry.title)
        hiddenToolCount++
        return false
      }
      // Hide completed thinking blocks when showThinkingBlocks is off
      if (entry.kind === "reasoning" && !showThinkingBlocks()) {
        return false
      }
      return true
    }

    const ensureTurn = () => {
      const existing = result[result.length - 1]
      if (existing) return existing
      const created: DisplayTurn = { entries: [] }
      result.push(created)
      return created
    }

    const allMsgs = messages()
    for (let msgIdx = 0; msgIdx < allMsgs.length; msgIdx++) {
      const msg = allMsgs[msgIdx]
      if (msg.role === "user" && msg.content) {
        result.push({
          user: { kind: "user", text: msg.content },
          entries: [],
          userMsgIndex: msgIdx,
        })
        continue
      }

      const entries = messageToBlocks(msg).filter(shouldShowEntry)
      if (entries.length === 0) continue
      ensureTurn().entries.push(...entries)
    }

    // Add compact tool summary after the last turn that had hidden tools
    if (hiddenToolCount > 0) {
      const lastTurn = result[result.length - 1]
      if (lastTurn) {
        const toolList = [...hiddenToolNames].slice(0, 5).join(", ")
        const summary = hiddenToolNames.size > 5
          ? `⚙ ${hiddenToolCount} calls · ${toolList}, …  (/tools to show)`
          : `⚙ ${hiddenToolCount} calls · ${toolList}  (/tools to show)`
        lastTurn.entries.push({ kind: "system", text: summary, streaming: false })
      }
    }

    // Attach recent notices to the last turn so they appear as part of the
    // conversation rather than separate pinned blocks at the bottom.
    const recentNotices = notices().slice(-3)
    if (recentNotices.length > 0 && result.length > 0) {
      const lastTurn = result[result.length - 1]
      for (const n of recentNotices) {
        lastTurn.entries.push(n)
      }
    } else if (recentNotices.length > 0) {
      for (const n of recentNotices) {
        result.push({ entries: [n] })
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

  const streamingEntries = createMemo<DisplayBlock[]>(() =>
    streamState.parts().map((part) => {
      switch (part.type) {
        case "text":
          return { kind: "assistant", text: part.text, streaming: true } satisfies DisplayBlock
        case "reasoning":
          return { kind: "reasoning", text: stripAnsi(part.text), title: "Thinking", streaming: true } satisfies DisplayBlock
        case "tool-call":
          return { kind: "tool-call", text: part.input || "{}", title: part.tool, streaming: true } satisfies DisplayBlock
        case "tool-result":
          return { kind: part.error ? "error" : "tool", text: part.output, title: part.tool, streaming: true } satisfies DisplayBlock
      }
    }),
  )

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
    clearTimeout(copyNoticeTimer)
    copyNoticeTimer = setTimeout(() => setCopyNotice(false), 2000)
  }

  const doSaveCurrent = () => {
    const id = sessionId()
    const msgs = messages()
    saveSession(id, msgs, currentModel, currentProvider, mode(), compaction(), permissionRules(), autoApprove())
  }

  const refreshSessions = () => {
    setSessionMeta(currentSessionMeta())
    setSessionRevision((v) => v + 1)
  }

  const doSwitchSession = (id: string) => {
    doSaveCurrent()
    const loaded = loadSessionState(id)
    if (loaded?.provider && loaded.model) {
      applyProviderModel(loaded.provider, loaded.model)
    } else {
      // No provider/model in session — UI labels still need refreshing
      setSelectionRevision((v) => v + 1)
    }
    setMessages(loaded?.messages ?? [])
    setMode(loaded?.mode === "plan" ? "plan" : "build")
    setCompaction(loaded?.compaction)
    setPermissionRules(loaded?.permissionRules ?? [])
    setAutoApprove(loaded?.autoApprove ?? false)
    setNotices([])
    setSessionId(id)
    setCurrentSessionId(id)
    refreshSessions()
    setComposerText("")
    setDraft("")
  }

  
  const doEditUserMessage = (msgIndex: number, text: string) => {
    // Truncate messages up to (not including) the target user message,
    // then put its content back in the composer for re-editing
    setMessages(prev => prev.slice(0, msgIndex))
    setComposerText(text)
    setStatus("editing message — press Enter to resubmit")
  }

  // Fork from a specific index in messages() array
  const doForkFromMessageIndex = (messagesIdx: number) => {
    const allMsgs = messages()
    if (messagesIdx < 0 || messagesIdx >= allMsgs.length) return
    doSaveCurrent()
    const msgsUpToTarget = allMsgs.slice(0, messagesIdx + 1)
    const targetMsg = allMsgs[messagesIdx]
    const meta = createSession(currentModel, currentProvider, msgsUpToTarget)
    setSessionId(meta.id)
    setSessionMeta(meta)
    setSessionRevision((v) => v + 1)
    setMessages(msgsUpToTarget)
    setNotices([])
    setPermissionRules(permissionRules())
    setComposerText(targetMsg.content ?? "")
    setDraft(targetMsg.content ?? "")
    setStatus("forked session from message")
  }

  // Fork from a timeline message index (index into timelineMsgs())
  const doForkFromMessage = (msgIdx: number) => {
    const msgs = timelineMsgs()
    if (msgIdx < 0 || msgIdx >= msgs.length) return
    const targetIdx = messages().indexOf(msgs[msgIdx])
    doForkFromMessageIndex(targetIdx)
  };

  const doCreateNewSession = () => {
    doSaveCurrent()
    const meta = createSession(currentModel, currentProvider)
    setSessionId(meta.id)
    setSessionMeta(meta)
    setSessionRevision((v) => v + 1)
    setMessages([])
    setNotices([])
    setPermissionRules([])
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

      const newCompaction: CompactionInfo = {
        summary,
        createdAt: new Date().toISOString(),
        sourceMessageCount: head.length,
      }
      setMessages(tail)
      setCompaction(newCompaction)
      saveSession(sessionId(), tail, currentModel, currentProvider, mode(), newCompaction, permissionRules(), autoApprove())
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
    const rawInput = draft().trim()
    if (!rawInput) return

    // Expand pasted markers back to full content
    let input = rawInput
    for (const [marker, content] of pastedContent) {
      if (input.includes(marker)) {
        input = input.replace(marker, content)
      }
    }

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
      // Handle display toggles that need local signal access
      const slashCmd = input.slice(1).split(/\s+/)[0]?.toLowerCase()
      if (slashCmd === "tools" || slashCmd === "tool-details") {
        setShowCompletedTools(c => !c)
        const state = showCompletedTools() ? "shown" : "hidden"
        setNotices((prev) => [...prev, { kind: "system", text: `Completed tool details: ${state}` }])
        setComposerText("")
        queueMicrotask(scrollBottom)
        return
      }
      if (slashCmd === "thinking") {
        setShowThinkingBlocks(c => !c)
        const state = showThinkingBlocks() ? "visible" : "hidden"
        setNotices((prev) => [...prev, { kind: "system", text: `Thinking blocks: ${state}` }])
        setComposerText("")
        queueMicrotask(scrollBottom)
        return
      }
      if (slashCmd === "auto" || slashCmd === "auto-approve") {
        setAutoApprove(c => !c)
        const state = autoApprove() ? "ON" : "OFF"
        setNotices((prev) => [...prev, { kind: "system", text: `Auto-approve: ${state}` }])
        setComposerText("")
        queueMicrotask(scrollBottom)
        return
      }
      if (slashCmd === "commit") {
        setComposerText("Please help generate a commit message and commit the changes")
        queueMicrotask(scrollBottom)
        return
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

    // Auto-compact if context is near limit (> 80%)
    {
      const cfg = getModelConfig(currentModel)
      const totalText = stripCompactSummaryMessages(messages()).map(m => m.content ?? "").join(" ") + input
      if (estimateTokens(totalText) > cfg.contextLimit * 0.8) {
        await compactCurrentSession()
      }
    }

    runAbort = new AbortController()
        streamState.reset()
        refreshAgentsInstruction()
        setRunning(true)
        setStatus("thinking...")

    // Mark session as active (visible to other processes)
    const activeSessionId = sessionId()
    markSessionActive(activeSessionId)

    // Clear notices only when streaming actually starts (first chunk received),
    // so error notices from a failed stream persist until the next successful response.
    let noticesCleared = false
    const clearNoticesOnce = () => {
      if (!noticesCleared) {
        noticesCleared = true
        setNotices([])
      }
    }

    try {
      const next = await runSession(input, sanitizeMessages(messages()), {
        abort: runAbort.signal,
        streamReasoningChunk: (text) => { clearNoticesOnce(); streamState.streamReasoningChunk(text) },
        streamAssistantChunk: (text) => { clearNoticesOnce(); streamState.streamAssistantChunk(text) },
        streamToolCallChunk: (index, input) => { clearNoticesOnce(); streamState.streamToolCallChunk(index, input) },
        setStreamingToolResult: (input) => streamState.setToolResult(input),
        addMessage: (msg) => {
          if (msg.role === "assistant") streamState.reset()
          if (msg.role === "tool") streamState.reset()
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
        compactionSummary: compaction()?.summary,
        ask: (req) => new Promise<void>((resolve, reject) => {
          if (shouldAutoApprove(req, permissionRules())) { resolve(); return }
          // Auto-approve mode: auto-approve non-bash permissions,
          // and bash commands that are not destructive.
          if (autoApprove()) {
            if (req.permission === "bash") {
              const dangerous = req.patterns.some((p) => isDangerousBashCommand(p))
              if (dangerous) {
                const request = { ...req, id: `perm_${Date.now()}` }
                setPendingApproval({
                  request,
                  resolve,
                  reject,
                  allowAlways: () => {
                    setPermissionRules((prev) => addPermissionRules(prev, req))
                    resolve()
                  },
                })
                return
              }
            }
            resolve(); return
          }
          const request = { ...req, id: `perm_${Date.now()}` }
          setPendingApproval({
            request,
            resolve,
            reject,
            allowAlways: () => {
              setPermissionRules((prev) => addPermissionRules(prev, req))
              resolve()
            },
          })
        }),
      })

      setMessages(next)
      saveSession(sessionId(), next, currentModel, currentProvider, mode(), compaction(), permissionRules(), autoApprove())
      setComposerText("")
      setStatus("waiting for input")
      queueMicrotask(scrollBottom)
    } catch (err) {
      // AbortError = user cancelled — no noise needed
      const isAbort = err instanceof Error && (err.name === "AbortError" || err.message === "aborted")
      if (!isAbort) {
        const msg = err instanceof Error ? err.message : String(err)
        setNotices((prev) => [...prev, { kind: "error", text: `Error: ${msg}` }])
        setStatus("error")
      }
    } finally {
      unmarkSessionActive(activeSessionId)
      runAbort = undefined
      setRunning(false)
    }
  }

  useKeyboard((event) => {
    const approval = pendingApproval()
    if (approval) {
      if (event.name === "y" || event.name === "return") {
        setPendingApproval(undefined)
        approval.resolve()
      } else if (event.name === "a") {
        setPendingApproval(undefined)
        approval.allowAlways()
      } else if (event.name === "n" || event.name === "escape" || event.name === "q") {
        setPendingApproval(undefined)
        approval.reject(new Error("denied by user"))
      }
      event.preventDefault()
      return
    }
    // Splash screen input handling
    if (showSplash()) {
      if (event.name === "return" || event.name === "enter") {
        const selIdx = splashSelectedIndex()
        if (selIdx >= 0 && splashSessions[selIdx]) {
          doSwitchSession(splashSessions[selIdx].id)
        } else {
          doCreateNewSession()
        }
        setShowSplash(false)
        renderer.setTerminalTitle("openzerocode")
        event.preventDefault()
        return
      }

      if (event.name === "up") {
        setSplashSelectedIndex(i => Math.max(-1, i - 1))
        event.preventDefault()
        return
      }

      if (event.name === "down") {
        setSplashSelectedIndex(i => Math.min(splashSessions.length - 1, i + 1))
        event.preventDefault()
        return
      }

      if (event.name === "escape") {
        setSplashSelectedIndex(-1)
        event.preventDefault()
        return
      }

      event.preventDefault()
      return
    }

    if (event.ctrl && event.name === "c") {
      void exitApp(0)
      event.preventDefault()
      return
    }
    if ((event.ctrl && event.name === "p") || event.name === "f2") {
      setShowPalette((open) => !open)
      setPalettePendingDelete(null)
      setPaletteMode("actions")
      setPaletteIndex(firstSelectablePaletteIndex(actionPaletteItems()))
      event.preventDefault()
      return
    }
    if (event.ctrl && event.name === "l") {
      autoLayoutOverride = true
      setLayoutMode(m => m === "horizontal" ? "vertical" : "horizontal")
      if (layoutMode() === "vertical") setSidebarCollapsed(true)
      event.preventDefault()
      return
    }
    if (showPalette()) {
      // Text input for ALL palette modes (rename=text entry, models=filter, others=filter)
      if (event.name === "backspace") {
        setPaletteInput(prev => prev.slice(0, -1))
        event.preventDefault()
        return
      }
      if (event.name === "space") {
        setPaletteInput(prev => prev + " ")
        event.preventDefault()
        return
      }
      if (event.name && event.name.length === 1 && !event.ctrl && !event.meta) {
        setPaletteInput(prev => prev + event.name)
        event.preventDefault()
        return
      }
      if (paletteMode() === "rename") {
        if (event.name === "escape") {
          setPalettePendingDelete(null)
          setPaletteMode("actions")
          setPaletteIndex(firstSelectablePaletteIndex(actionPaletteItems()))
          event.preventDefault()
          return
        }
        if (event.name === "return") {
          const sid = sessionId()
          updateSessionMeta(sid, { title: paletteInput() })
          refreshSessions()
          setShowPalette(false)
          setPaletteMode("actions")
          event.preventDefault()
          return
        }
      }
      if (paletteMode() === "addProviderKeyName") {
        if (event.name === "escape") {
          setPaletteInput("")
          setPaletteMode("providerKeys")
          setPaletteIndex(0)
          event.preventDefault()
          return
        }
        if (event.name === "return") {
          const name = paletteInput().trim()
          if (!name) {
            setStatus("key name cannot be empty")
            return
          }
          setPaletteNewKeyName(name)
          setPaletteInput("")
          setPaletteMode("addProviderKeyValue")
          setPaletteIndex(0)
          event.preventDefault()
          return
        }
      }
      if (paletteMode() === "addProviderKeyValue") {
        if (event.name === "escape") {
          setPaletteInput("")
          setPaletteMode("providerKeys")
          setPaletteIndex(0)
          event.preventDefault()
          return
        }
        if (event.name === "return") {
          const value = paletteInput().trim()
          if (!value) {
            setStatus("key value cannot be empty")
            return
          }
          const result = addConfiguredProviderKey(paletteProviderKeyTarget(), paletteNewKeyName(), value)
          setStatus(result.message)
          if (result.ok) {
            setProviderConfigRevision(v => v + 1)
            setPaletteInput("")
            setPaletteMode("providerKeys")
            setPaletteIndex(0)
          }
          event.preventDefault()
          return
        }
      }
      if (paletteMode() === "models") {
        if (event.name === "escape") {
          const backMode = paletteModelBackMode()
          setPaletteInput("")
          setPaletteMode(backMode)
          setPaletteIndex(firstSelectablePaletteIndex(backMode === "providers" ? providerPaletteItems() : actionPaletteItems()))
          event.preventDefault()
          return
        }
        if (event.name === "return") {
          const item = paletteItems()[paletteIndex()]
          if (isSelectablePaletteItem(item)) item?.onSelect()
          event.preventDefault()
          return
        }
      }
      if (paletteMode() === "sessions" && event.ctrl && event.name === "d") {
        const item = displayItems()[paletteIndex()]
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
      if (paletteMode() === "providerKeys" && event.ctrl && event.name === "d") {
        const item = displayItems()[paletteIndex()]
        const keyName = item?.sessionId
        if (!keyName) {
          event.preventDefault()
          return
        }
        if (palettePendingDelete() === keyName) {
          const result = removeConfiguredProviderKey(paletteProviderKeyTarget(), keyName)
          setStatus(result.message)
          if (result.ok) setProviderConfigRevision(v => v + 1)
          setPalettePendingDelete(null)
          event.preventDefault()
          return
        }
        setPalettePendingDelete(keyName)
        setStatus(`press ctrl+d again to remove key "${keyName}"`)
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
        } else if (paletteMode() === "display") {
          setPaletteMode("actions")
          setPaletteIndex(firstSelectablePaletteIndex(actionPaletteItems()))
        } else if (paletteMode() === "timeline") {
          setPaletteMode("actions")
          setPaletteIndex(firstSelectablePaletteIndex(actionPaletteItems()))
        } else if (paletteMode() === "userMessageActions") {
          setUserMsgActionTarget(null)
          setShowPalette(false)
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
        const item = displayItems()[paletteIndex()]
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
      {/* ── Splash screen (shown on first launch) ── */}
      <Show when={showSplash()}>
        <SplashScreen
          selectedIndex={splashSelectedIndex()}
          sessions={splashSessions}
          layoutMode={layoutMode()}
          model={modelLabel()}
          provider={providerLabel()}
        />
      </Show>

      {/* ── Main work UI (hidden while splash is shown) ── */}
      <Show when={!showSplash()}>
<box
        flexDirection={layoutMode() === "horizontal" ? "row" : "column"}
        flexGrow={1}
        minHeight={0}
        position={layoutMode() === "vertical" ? "relative" : undefined}
      >
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
          {(turn, index) => (
            <TurnEntry
              turn={turn}
              isFirst={index() === 0}
              onUserClick={(msgIndex, text) => {
                setUserMsgActionTarget({ index: msgIndex, text })
                setPaletteMode("userMessageActions")
                setPaletteIndex(0)
                setShowPalette(true)
              }}
              isRunning={running()}
            />
          )}
        </For>
        <Show when={running() && streamingEntries().length > 0}>
          <box marginTop={1} flexDirection="column">
            <For each={streamingEntries()}>
              {(entry, index) => <ResponseEntry entry={entry} isFirst={index() === 0} />}
            </For>
          </box>
        </Show>
      </scrollbox>

      <Show when={pendingApproval()}>
        {(approval: () => PendingApproval) => (
          <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} border={["left", "top"]} borderColor="#f85149" backgroundColor={THEME.surface}>
            <text style={{ fg: "#f85149" }}>PERMISSION REQUIRED</text>
            <text style={{ fg: THEME.text }}>{`${approval().request.permission}: ${approval().request.patterns.join("  ")}`}</text>
            <text style={{ fg: THEME.muted }}>{"y / Enter = allow once   a = always allow in this session   n / Escape = deny"}</text>
          </box>
        )}
      </Show>

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
                syntaxStyle={MARKDOWN_SYNTAX}
                minHeight={composerCollapsed() ? 1 : 1}
                maxHeight={composerCollapsed() ? 1 : 12}
                width="100%"
                focused={!showPalette()}
                ref={(node) => {
                  composer = node
                  if (node && pasteExtmarkTypeId === 0) {
                    pasteExtmarkTypeId = node.extmarks.registerType("paste")
                  }
                }}
                onContentChange={() => setDraft(composer?.plainText ?? "")}
                onSubmit={() => { void submit() }}
                onPaste={(event) => {
                  const text = new TextDecoder().decode(event.bytes)
                    .replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
                  if (!text) return
                  const lineCount = (text.match(/\n/g)?.length ?? 0) + 1
                  if (lineCount >= 3 || text.length > 200) {
                    event.preventDefault()
                    if (!composer || pasteExtmarkTypeId === 0) return
                    pasteCounter++
                    const marker = `[Pasted ~${lineCount} lines #${pasteCounter}]`
                    const cursor = composer.visualCursor.offset
                    composer.insertText(marker + " ")
                    composer.extmarks.create({
                      start: cursor,
                      end: cursor + marker.length,
                      virtual: true,
                      styleId: pasteStyleId,
                      typeId: pasteExtmarkTypeId,
                    })
                    pastedContent.set(marker, text)
                    return
                  }
                }}
              />
            </box>
            <box paddingTop={1} paddingBottom={1} flexDirection="row">
              <text style={{ fg: mode() === "build" ? "#58a6ff" : "#3fb950" }}>
                {mode() === "build" ? "Build" : "Plan"}
              </text>
              <text style={{ fg: THEME.muted }}>{"  •  "}</text>
              <text style={{ fg: THEME.text }}>{truncateText(modelLabel(), 32)}</text>
              <Show when={autoApprove()}>
                <text style={{ fg: THEME.muted }}>{"  •  "}</text>
                <text style={{ fg: "#3fb950" }}>{"AUTO"}</text>
              </Show>
              {/* Sidebar toggle in vertical mode */}
              <Show when={layoutMode() === "vertical"}>
                <text style={{ fg: THEME.muted }}>{"  •  "}</text>
                <text
                  style={{ fg: sidebarCollapsed() ? THEME.accent : THEME.muted }}
                  onMouseDown={() => setSidebarCollapsed(c => !c)}
                >
                  {sidebarCollapsed() ? "[+sidebar]" : "[-sidebar]"}
                </text>
              </Show>
              {/* Layout mode indicator */}
              <Show when={layoutMode() === "vertical"}>
                <text style={{ fg: THEME.muted }}>{"  •  "}</text>
                <text style={{ fg: "#8b949e" }}>{"VERT"}</text>
              </Show>
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

      {/* Horizontal mode: sidebar as flex sibling */}
      <Show when={layoutMode() === "horizontal"}>
        <Sidebar
          messages={messages}
          theme={THEME}
          width={SIDEBAR_WIDTH}
          provider={providerLabel()}
          model={modelLabel()}
          sessionTitle={sessionMeta()?.title}
          cwd={process.cwd()}
          sessionId={sessionId()}
        />
      </Show>

      {/* Vertical mode: sidebar as absolute overlay (collapsible) */}
      <Show when={layoutMode() === "vertical" && !sidebarCollapsed()}>
        <box
          position="absolute"
          right={0}
          top={0}
          height="100%"
          width={SIDEBAR_WIDTH + 1}
          zIndex={50}
          flexDirection="row"
        >
          <box width={1} backgroundColor={THEME.border} flexShrink={0} />
          <Sidebar
            messages={messages}
            theme={THEME}
            width={SIDEBAR_WIDTH}
            provider={providerLabel()}
            model={modelLabel()}
            sessionTitle={sessionMeta()?.title}
            cwd={process.cwd()}
            sessionId={sessionId()}
          />
        </box>
      </Show>
      </box>

      <SlashAutocomplete
        commands={BUILTIN_COMMANDS}
        draft={draft}
        ref={(api) => { autocompleteApi = api }}
        onCommand={(name) => {
          const noArgs = new Set(["help", "clear", "info", "exit", "quit", "commit"])
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
          top={Math.floor((dimensions().height - (paletteMode() === "rename" || paletteMode() === "addProviderKeyName" || paletteMode() === "addProviderKeyValue" ? 7 : (paletteMode() === "models" ? paletteItems().length : filteredPaletteItems().length) + 6)) / 2)}
          left={layoutMode() === "horizontal"
            ? Math.floor((dimensions().width - 2 - PALETTE_WIDTH) / 2)
            : 2
          }
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
                      : paletteMode() === "providerKeys"
                        ? `Keys · ${paletteProviderKeyTarget()}`
                      : paletteMode() === "addProviderKeyName"
                        ? `Add Key · ${paletteProviderKeyTarget()}`
                      : paletteMode() === "addProviderKeyValue"
                        ? `Key Value · ${paletteNewKeyName()}`
                      : paletteMode() === "timeline"
                        ? "Timeline"
                        : paletteMode() === "userMessageActions"
                          ? "Message Actions"
                      : "Command Palette"}
            </text>
            <text style={{ fg: THEME.muted }}>  F2 / Ctrl+P</text>
          </box>
          <box border={["top"]} borderColor={THEME.border} flexDirection="column">
            <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column" gap={1}>
                <text style={{ fg: THEME.muted }}>
                  {paletteMode() === "rename" ? "Enter new name:" : paletteMode() === "models" ? "Filter models:" : paletteMode() === "addProviderKeyName" ? "Enter key name:" : paletteMode() === "addProviderKeyValue" ? "Enter key value:" : "Filter:"}
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
            <Show when={paletteMode() !== "rename" && paletteMode() !== "addProviderKeyName" && paletteMode() !== "addProviderKeyValue"}>
              <For each={paletteMode() === "models" ? paletteItems() : filteredPaletteItems()}>
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
                  : paletteMode() === "addProviderKeyName" || paletteMode() === "addProviderKeyValue"
                  ? "Enter confirm  •  Esc back"
                  : paletteMode() === "sessions"
                  ? "Type to filter  •  ↑↓ navigate  •  Enter select  •  Ctrl+D delete  •  Esc back"
                  : paletteMode() === "models"
                    ? "Type to filter  •  ↑↓ navigate  •  Enter select  •  Esc back"
                    : paletteMode() === "providers"
                      ? "Type to filter  •  ↑↓ navigate  •  Enter select  •  Esc back"
                    : paletteMode() === "providerKeys"
                      ? "↑↓ navigate  •  Enter select  •  Ctrl+D delete  •  Esc back"
                    : "Type to filter  •  ↑↓ navigate  •  Enter select  •  Esc close"}
            </text>
          </box>
        </box>
      </Show>

      {/* ── Close the `showSplash === false` block ── */}
      </Show>

    </box>
  )
}

render(() => <App />).catch((error) => {
  console.error(error)
  process.exit(1)
})
