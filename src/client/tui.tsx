import { For, Index, Show, createEffect, createMemo, createSignal } from "solid-js"
import { render, useKeyboard, usePaste, useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { ScrollBoxRenderable, TextareaRenderable, PasteEvent } from "@opentui/core"
import { Effect, Layer } from "effect"
import { buildLayer, autoDetectProvider, defaultModelForProvider, PROVIDERS, normalizeBigPickleModel, getCachedModelInfo, getCachedModels, setCachedModels } from "../provider/index"
import { layer as toolLayer } from "../tool/registry"
import { ToolRegistry } from "../tool/registry"
import { Provider, type ModelInfo } from "../provider/types"
import type { Message } from "../provider/types"
import type { PermissionRequest, Def } from "../tool/types"
import { listSelectableGroups, toggleGroup, TOOL_GROUPS } from "../tool/selection"
import { loadMcpConfig, mcpGroupId } from "../mcp/config"
import { setConfiguredServers, getConfiguredServers, loadMcpServer, unloadMcpServer, isServerLoaded, isServerLoading, unloadAllMcpServers } from "../mcp/store"
import { createStreamState } from "./stream-state"
import { runSession, type RunMode, type StreamOptions } from "./session-runner"
import { SlashAutocomplete } from "./autocomplete"
import { cycleCommandArgument } from "./autocomplete-logic"
import type { AutocompleteApi } from "./autocomplete"
import { BUILTIN_COMMANDS, executeCommand, type CommandContext, type CommandToastKind } from "./commands"
import { HELP_CONTENT } from "./help-content"
import type { SkillSummary } from "./skill-loader"
import { Sidebar, type GitFile } from "./sidebar"
import { createSession, deleteSession, getCurrentSessionId, loadSessionState, saveSession, setCurrentSessionId, currentSessionMeta, listSessions, updateSessionMeta, markSessionActive, unmarkSessionActive, isSessionActive, getSessionActiveInfo, isDefaultTitle, deriveTitle, type CompactionInfo } from "./sessions"
import { getModelConfig } from "../provider/models"
import { formatQueueStatus, summaryPreview, formatCompactionMarker, normalizeDiffHunkCounts, tryParseJSON, formatToolCallInput, formatToolResultPreview, stripAnsi, truncateText, fmtContextLimit, fmtPrice, modelHint, isTransientPasteMarker, maskKey, contentToText } from "./format-utils"
import { homeDir, expandHome, displayPath, resolveDirectoryPath, isDirectory, directoryCandidates } from "./path-utils"
import { buildCompactionTranscript, selectCompactionTail, stripCompactSummaryMessages, shouldAutoCompactContext } from "./session-compact"
import { formatProviderError, isRateLimitError } from "./errors"
import { ensureGlobalMemoryFiles, loadAgentsInstruction, loadContextInstruction } from "./workspace-memory"
import { getActiveConfiguredProviderKeyName, getProviderConfigPath, listConfiguredProviderKeys, setActiveConfiguredProviderKey, addConfiguredProviderKey, removeConfiguredProviderKey, readProviderConfig, writeProviderConfig, getStoredProviderConfig, setConfiguredProviderBaseURL } from "../provider/config"
import { startCodexBrowserAuthorization, startCodexDeviceAuthorization, isOAuthCallbackUrl, extractCallbackCode, listCodexAuths, activateCodexAuth, deleteCodexAuth, setCodexAuthKeyname } from "../provider/codex-auth"
import { hasXaiAuth, startXaiDeviceAuthorization, deleteXaiAuth } from "../provider/xai-auth"
import { buildSystemPrompt } from "./system-prompt"
import { addDefaultParsers } from "@opentui/core"
import parsers from "../../parsers-config"

// Register tree-sitter WASM parsers for syntax highlighting
addDefaultParsers(parsers.parsers)
import { THEME, MARKDOWN_SYNTAX } from "./theme"
import { ToastViewport } from "./toast-viewport"
import type { ToastItem } from "./toast-viewport"
import { ResponseEntry } from "./response-entry"
import type { DisplayBlock } from "./response-entry"
import { TurnEntry } from "./turn-entry"
import type { DisplayTurn } from "./turn-entry"
import { setTodoUpdateCallback, type TodoItem } from "../tool/todo"
import { addPermissionRules, shouldAutoApprove, isDangerousBashCommand, type PermissionRule } from "./permission-rules"
import { sanitizeMessages } from "./message-sanitize"
import { SplashScreen } from "./splash"
import { MarkdownWithDiff } from "./markdown-with-diff"
import { DIFF_RENDER_PROPS } from "./diff-rendering"
import { testConnection, isConnected, setEnabled, setRuntimeSessionId } from "../browser/geass-client"
import { getDefaultLocalVlmEndpoint, getDefaultLocalVlmModel, normalizeLocalVlmEndpoint, setProcessLocalVlmConfig } from "../browser/local-vlm-client"
import { loadUIPrefs, saveUIPrefs } from "./ui-prefs"
import { UsageDashboard, VIEW_MODES, type ViewMode } from "./usage-dashboard"
import { appendUsageEntry } from "./usage-stats"
import { createInputQueue, type QueueItem } from "./input-queue"
import {
  AUTOPILOT_RATE_LIMIT_BACKOFF_MS,
  AUTOPILOT_RATE_LIMIT_TOTAL_WAIT_MS,
  autopilotRateLimitDelayMs,
  buildAutopilotSupervisorPrompt,
  formatAutopilotNoticeTime,
  formatAutopilotRetryDelay,
  parseAutopilotDecision,
  type AutopilotDecision,
  type AutopilotMode,
} from "./autopilot"
import { writeCompactTranscriptExport } from "./session-export"
import { registerPeer, unregisterPeer, listLivePeers, findPeer, canonicalWorkdir } from "../peer/registry"
import { startPeerServer } from "../peer/server"
import { configurePeerBudget, setPeerContext } from "../peer/context"
import { handleCli } from "./cli"
import { encodePeerInput, decodePeerInput } from "./peer-input"
import { EMPTY_STATE_MESSAGE, SCROLL_HINT, PROMPT_KEY_BINDINGS, sidebarWidthForTerminal } from "./tui-constants"
import { getGitFileChanges, copyToClipboard, readClipboard, openExternalUrl } from "./process-utils"
import { messageToBlocks } from "./message-blocks"
import { getFileDiff } from "./git-diff"
import pkg from "../../package.json" with { type: "json" }

// Version — injected at build time via scripts/build.ts; falls back to package.json in dev mode
const VERSION: string =
  (typeof process !== "undefined" && (process.env as Record<string, string>)["__OPENZEROCODE_VERSION__"]) ||
  pkg.version

// Handle CLI flags before booting the TUI.
const args = process.argv.slice(2)
await handleCli(args, VERSION)

// ─── Peer mode ──────────────────────────────────────────────────────────────
// Module-level state shared between peer server (started before render) and
// the SolidJS component (which wires up the enqueue callback after mount).
let activePeerName: string | undefined
let _peerEnqueueFn: ((text: string, fromPeer: string, hop: number, options?: { samePairRoundtrips?: number; oneWay?: boolean }) => void) | undefined
const pendingPeerInputs: Array<{ text: string; fromPeer: string; hop: number; samePairRoundtrips?: number; oneWay?: boolean }> = []

{
  const numericFlag = (name: string): number | undefined => {
    const eq = args.find((a) => a.startsWith(`${name}=`))
    const idx = args.indexOf(name)
    const raw = eq ? eq.slice(name.length + 1) : idx >= 0 ? args[idx + 1] : undefined
    const value = Number.parseInt(raw ?? "", 10)
    return Number.isFinite(value) && value > 0 ? value : undefined
  }
  configurePeerBudget({
    maxHops: numericFlag("--max-peer-hops"),
    maxSamePairRoundtrips: numericFlag("--max-same-pair-roundtrips"),
  })

  const nameIdx = args.indexOf("--name")
  const nameArg = nameIdx >= 0 && args[nameIdx + 1] ? args[nameIdx + 1] : undefined
  if (nameArg) {
    // Generate token first so we can start the server before writing the registry.
    // The port is only known after the server starts, so registration happens after.
    const { generateToken } = await import("../peer/registry")
    const token = generateToken()
    const server = await startPeerServer(token, (text, from, hop, options) => {
      if (_peerEnqueueFn) _peerEnqueueFn(text, from, hop, options)
      else pendingPeerInputs.push({ text, fromPeer: from, hop, ...options })
    })
    const result = registerPeer(nameArg, server.port, process.cwd(), token)
    if (!result.ok) {
      console.error(`openzerocode: ${result.error}`)
      server.stop()
      process.exit(1)
    }
    activePeerName = nameArg

    process.on("exit", () => { unregisterPeer(nameArg) })
    process.on("SIGINT", () => { unregisterPeer(nameArg); process.exit(0) })
    process.on("SIGTERM", () => { unregisterPeer(nameArg); process.exit(0) })
  }
}

const initialUIPrefs = loadUIPrefs()
setProcessLocalVlmConfig({
  endpoint: initialUIPrefs.localVlmEndpoint,
  model: initialUIPrefs.localVlmModel,
  force: initialUIPrefs.forceLocalVlm,
})

let currentProvider = autoDetectProvider() ?? "opencode-zen"
let currentModel = currentProvider === "opencode-zen"
  ? normalizeBigPickleModel(process.env.OPENZERO_MODEL ?? defaultModelForProvider(currentProvider))
  : (process.env.OPENZERO_MODEL ?? defaultModelForProvider(currentProvider))
let currentModelInfo: ModelInfo | undefined = getCachedModelInfo(currentProvider, currentModel)
let currentLayer = Layer.merge(buildLayer(currentProvider, currentModel), toolLayer)
let agentsInstruction = loadAgentsInstruction(process.cwd())
let contextInstruction = loadContextInstruction(process.cwd())

function refreshCurrentModelInfo() {
  currentModelInfo = getCachedModelInfo(currentProvider, currentModel)
}

function rebuildLayer() {
  currentLayer = Layer.merge(buildLayer(currentProvider, currentModel), toolLayer)
  refreshCurrentModelInfo()
}

function defaultModelForCurrentProvider(providerId: string) {
  const configured = process.env.OPENZERO_MODEL ?? defaultModelForProvider(providerId)
  return providerId === "opencode-zen" ? normalizeBigPickleModel(configured) : configured
}

function runSync<E, A>(effect: Effect.Effect<A, E, ToolRegistry | Provider>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(currentLayer)))
}

function systemPrompt(mode: RunMode) {
  return buildSystemPrompt(mode, agentsInstruction, contextInstruction, process.cwd())
}

function peerRequestSystemPrompt(peerOrigin: string, oneWay: boolean | undefined): string {
  if (oneWay) {
    return `\n\n[Peer Notice]\nThis one-way message was sent by peer process "${peerOrigin}" for notification or handoff-summary purposes. Do not call_peer back unless the user explicitly asks you to start a new collaboration thread.`
  }

  return `\n\n[Peer Request]\nThis task was sent by peer process "${peerOrigin}". ` +
    `After completing the task, use the call_peer tool to send a concise summary of what you did and any relevant results back to "${peerOrigin}". ` +
    `If the task cannot be completed or requires clarification, call_peer back with that information instead.`
}

function refreshAgentsInstruction() {
  agentsInstruction = loadAgentsInstruction(process.cwd())
  contextInstruction = loadContextInstruction(process.cwd())
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
      if (loaded.mode === "plan" || loaded.mode === "compose") initialMode = loaded.mode
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
  // Bind each OpenZeroCode session to its own GEASS agent window so browser
  // requests don't all land on the main window. Runs on startup, switch, and
  // new-session creation since they all funnel through the sessionId signal.
  createEffect(() => { setRuntimeSessionId(sessionId()) })
  const [sessionMeta, setSessionMeta] = createSignal(currentSessionMeta())
  const [messages, setMessages] = createSignal(initialMessages)
  const [status, setStatus] = createSignal("waiting for input")
  const [draft, setDraft] = createSignal("")
  const [running, setRunning] = createSignal(false)
  const [compacting, setCompacting] = createSignal(false)
  const [queuedInputs, setQueuedInputs] = createSignal(0)
  const [queuedInputItems, setQueuedInputItems] = createSignal<QueueItem[]>([])
  const [mode, setModeRaw] = createSignal<RunMode>(initialMode)
  const setMode = (next: RunMode | ((prev: RunMode) => RunMode)) => {
    setModeRaw((prev) => {
      const resolved = typeof next === "function" ? (next as (prev: RunMode) => RunMode)(prev) : next
      return resolved
    })
  }
  const [reasoningEffort, setReasoningEffort] = createSignal<"low" | "medium" | "high" | "max" | undefined>("medium")
  const [compaction, setCompaction] = createSignal<CompactionInfo | undefined>(initialCompaction)
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
  const [paletteMode, setPaletteMode] = createSignal<"actions" | "autopilot" | "sessions" | "directories" | "rename" | "providers" | "models" | "providerKeyProviders" | "providerKeys" | "timeline" | "queuedMessages" | "display" | "experiments" | "maxSteps" | "localVlmEndpoint" | "localVlmModel" | "addProviderKeyName" | "addProviderKeyValue" | "editProviderBaseURL" | "userMessageActions" | "reference" | "codexKeyname">("actions")
  const [referenceTitle, setReferenceTitle] = createSignal("Help")
  const [referenceContent, setReferenceContent] = createSignal(HELP_CONTENT)
  const [referenceSkills, setReferenceSkills] = createSignal<SkillSummary[] | undefined>()
  const [userMsgActionTarget, setUserMsgActionTarget] = createSignal<{ index: number; text: string } | null>(null)
  const [paletteInput, setPaletteInput] = createSignal("")
  const [palettePendingDelete, setPalettePendingDelete] = createSignal<string | null>(null)
  const [paletteProviderTarget, setPaletteProviderTarget] = createSignal(currentProvider)
  const [paletteModelBackMode, setPaletteModelBackMode] = createSignal<"actions" | "providers">("actions")
  const [paletteProviderKeyTarget, setPaletteProviderKeyTarget] = createSignal(currentProvider)
  const [paletteNewKeyName, setPaletteNewKeyName] = createSignal("")
  const [paletteCodexKeynameTarget, setPaletteCodexKeynameTarget] = createSignal("")
  const [timelineTargetMsgIdx, setTimelineTargetMsgIdx] = createSignal(0)
  const [sessionRevision, setSessionRevision] = createSignal(0)
  const [lockPollRevision, setLockPollRevision] = createSignal(0)
  const [geassRevision, setGeassRevision] = createSignal(0)
  const [selectionRevision, setSelectionRevision] = createSignal(0)
  const [providerConfigRevision, setProviderConfigRevision] = createSignal(0)
  const [gitRefreshRevision, setGitRefreshRevision] = createSignal(0)
  const [cwdRevision, setCwdRevision] = createSignal(0)
  const [providerModels, setProviderModels] = createSignal<Record<string, ModelInfo[]>>({})
  const [providerModelsLoading, setProviderModelsLoading] = createSignal<string | null>(null)
  const [providerModelsError, setProviderModelsError] = createSignal<Record<string, string>>({})
  const streamState = createStreamState()
  const [notices, setNotices] = createSignal<DisplayBlock[]>([])
  const [toasts, setToasts] = createSignal<ToastItem[]>([])
  let nextToastId = 1
  const showToast = (kind: CommandToastKind, title: string, text?: string, duration = 3000) => {
    const id = nextToastId++
    setToasts((prev) => [...prev, { id, kind, title, text }].slice(-3))
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, duration)
  }
  const [todos, setTodos] = createSignal<TodoItem[]>([])
  setTodoUpdateCallback(setTodos)
  const _uiPrefs = initialUIPrefs
  // The Browser tool group is the single control for GEASS: if it is enabled,
  // turn the GEASS client on and probe the connection at startup.
  const _browserEnabled = !_uiPrefs.disabledToolGroups.includes("browser")
  setEnabled(_browserEnabled)
  if (_browserEnabled) {
    testConnection().then(() => setGeassRevision(v => v + 1))
  }
  const [showCompletedTools, setShowCompletedTools] = createSignal(_uiPrefs.showCompletedTools)
  const [showThinkingBlocks, setShowThinkingBlocks] = createSignal(_uiPrefs.showThinkingBlocks)
  const [autoApprove, setAutoApprove] = createSignal(initialAutoApprove)
  const [maxSteps, setMaxSteps] = createSignal(_uiPrefs.maxSteps)
  const [forceLocalVlm, setForceLocalVlm] = createSignal(_uiPrefs.forceLocalVlm)
  const [localVlmEndpoint, setLocalVlmEndpoint] = createSignal(_uiPrefs.localVlmEndpoint)
  const [localVlmModel, setLocalVlmModel] = createSignal(_uiPrefs.localVlmModel)
  const [disabledToolGroups, setDisabledToolGroups] = createSignal<string[]>(_uiPrefs.disabledToolGroups)
  const [registeredTools, setRegisteredTools] = createSignal<readonly Def[]>([])
  const refreshRegisteredTools = () =>
    runSync(Effect.gen(function* () {
      const r = yield* ToolRegistry
      return yield* r.all()
    })).then(setRegisteredTools).catch(() => {})
  refreshRegisteredTools()

  // MCP servers are opt-in: only auto-start ones the user has explicitly enabled.
  const [enabledMcpServers, setEnabledMcpServers] = createSignal<string[]>(_uiPrefs.enabledMcpServers)
  setConfiguredServers(loadMcpConfig())
  for (const server of getConfiguredServers()) {
    if (!enabledMcpServers().includes(server.id)) continue
    loadMcpServer(server)
      .then((n) => { refreshRegisteredTools(); setStatus(`MCP ${server.id}: ${n} tools loaded`) })
      .catch((e) => setStatus(`MCP ${server.id} failed: ${e instanceof Error ? e.message : String(e)}`))
  }
  const [autoCompressionEnabled, setAutoCompressionEnabled] = createSignal(_uiPrefs.autoCompressionEnabled)
  const [autopilotMode, setAutopilotMode] = createSignal<AutopilotMode>("off")
  const autopilotEnabled = () => autopilotMode() !== "off"
  const [composerCollapsed, setComposerCollapsed] = createSignal(false)
  const [layoutMode, setLayoutMode] = createSignal<"horizontal" | "vertical">(
    _uiPrefs.layoutMode ?? (dimensions().height > dimensions().width ? "vertical" : "horizontal")
  )
  const [showSplash, setShowSplash] = createSignal(true)
  const [showUsageDashboard, setShowUsageDashboard] = createSignal(false)
  const [usageDashboardView, setUsageDashboardView] = createSignal<ViewMode>("sessions")
  const [diffOverlay, setDiffOverlay] = createSignal<{ file: string; content: string } | null>(null)
  const [splashSelectedIndex, setSplashSelectedIndex] = createSignal(-1)
  const [sessionScope, setSessionScope] = createSignal<"cwd" | "global">("cwd")
  const currentCwd = createMemo(() => {
    cwdRevision()
    return process.cwd()
  })
  const splashSessions = createMemo(() => {
    sessionRevision()
    cwdRevision()
    return listSessions({ directory: currentCwd() })
  })
  const splashRecentSessions = createMemo(() => splashSessions().slice(0, 5))
  const splashSessionsAll = createMemo(() => {
    sessionRevision()
    cwdRevision()
    return listSessions({ directory: null })
  })
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
    if (!running() && !compacting()) return
    const id = setInterval(() => setSpinnerFrame(f => (f + 1) % SPINNER_FRAMES.length), 80)
    return () => clearInterval(id)
  })
  createEffect(() => { saveUIPrefs({ showCompletedTools: showCompletedTools() }) })
  createEffect(() => { saveUIPrefs({ showThinkingBlocks: showThinkingBlocks() }) })
  createEffect(() => { saveUIPrefs({ layoutMode: layoutMode() }) })
  createEffect(() => { saveUIPrefs({ autoCompressionEnabled: autoCompressionEnabled() }) })
  createEffect(() => {
    const endpoint = localVlmEndpoint()
    const model = localVlmModel()
    const force = forceLocalVlm()
    saveUIPrefs({ localVlmEndpoint: endpoint, localVlmModel: model, forceLocalVlm: force })
    setProcessLocalVlmConfig({ endpoint, model, force })
  })
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
  async function handleFileDiffRequest(file: GitFile) {
    const normalized = await getFileDiff(file.path)
    setDiffOverlay({ file: file.path, content: normalized || "(no diff available)" })
  }

  let scroll: ScrollBoxRenderable | undefined
  let composer: TextareaRenderable | undefined
  let autocompleteApi: AutocompleteApi | undefined
  let exitTask: Promise<void> | undefined
  let runAbort: AbortController | undefined
  let autopilotAbort: AbortController | undefined
  let autopilotSupervisorRunning = false
  let autopilotRateLimitTimer: ReturnType<typeof setTimeout> | undefined
  let autopilotRateLimitRetryCount = 0
  let history: string[] = []
  let historyIndex = -1
  let historyDraft = ""
  let compactionWaiters: Array<() => void> = []
  const notifyCompactionIdle = () => {
    const waiters = compactionWaiters.splice(0)
    for (const resolve of waiters) resolve()
  }
  const waitForCompactionToFinish = (abortSignal: AbortSignal) => {
    if (!compacting() || abortSignal.aborted) return Promise.resolve()
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        abortSignal.removeEventListener("abort", finish)
        resolve()
      }
      compactionWaiters.push(finish)
      abortSignal.addEventListener("abort", finish, { once: true })
    })
  }
  const inputQueue = createInputQueue(
    async (item, signal) => {
      await runQueuedPrompt(item.text, signal)
    },
    {
      onDepthChange: (depth) => {
        setQueuedInputs(depth)
        setQueuedInputItems(inputQueue.pendingItems())
      },
      onDrainEnd: () => {
        if (autopilotEnabled()) scheduleAutopilotCheck()
        else setStatus("waiting for input")
      },
    },
  )

  const openQueuedMessagesPalette = () => {
    setShowPalette(true)
    setPalettePendingDelete(null)
    setPaletteInput("")
    setQueuedInputItems(inputQueue.pendingItems())
    setPaletteMode("queuedMessages")
    setPaletteIndex(0)
  }

  // Wire peer enqueue now that inputQueue is ready, flushing any prompts
  // received during startup before the Solid component mounted.
  if (activePeerName) {
    _peerEnqueueFn = (text, fromPeer, hop, options) => {
      inputQueue.enqueue(encodePeerInput(fromPeer, hop, text, options))
    }
    for (const pending of pendingPeerInputs.splice(0)) {
      _peerEnqueueFn(pending.text, pending.fromPeer, pending.hop, {
        samePairRoundtrips: pending.samePairRoundtrips,
        oneWay: pending.oneWay,
      })
    }
  }

  async function runAutopilotSupervisor(): Promise<AutopilotDecision> {
    autopilotAbort?.abort()
    autopilotAbort = new AbortController()
    const signal = autopilotAbort.signal
    const mode = autopilotMode()
    if (mode === "off") return { confidence: "low", instruction: "", reason: "autopilot is off" }
    const supervisorPrompt = buildAutopilotSupervisorPrompt(mode)
    const msgHistory = sanitizeMessages(messages())
    const result = await runSync(Effect.gen(function* () {
      const provider = yield* Provider
      return yield* provider.complete({
        model: currentModel,
        stream: false,
        max_tokens: 300,
        signal,
        messages: [
          // Inject supervisor instructions as system role so conversation history
          // cannot override the safety rules via a strong assistant-tail directive
          { role: "system", content: supervisorPrompt },
          ...msgHistory,
          { role: "user", content: "Decide and output the JSON." },
        ],
      })
    }))
    return parseAutopilotDecision(contentToText(result.message.content))
  }

  function clearAutopilotRateLimitRetry(resetCount = true) {
    if (autopilotRateLimitTimer) {
      clearTimeout(autopilotRateLimitTimer)
      autopilotRateLimitTimer = undefined
    }
    if (resetCount) autopilotRateLimitRetryCount = 0
  }

  function scheduleAutopilotRateLimitRetry() {
    if (autopilotRateLimitTimer || autopilotMode() !== "proactive") return
    const delayMs = autopilotRateLimitDelayMs(autopilotRateLimitRetryCount)
    if (delayMs === undefined) {
      const total = formatAutopilotRetryDelay(AUTOPILOT_RATE_LIMIT_TOTAL_WAIT_MS)
      const attempts = AUTOPILOT_RATE_LIMIT_BACKOFF_MS.length
      configureAutopilot("off")
      setStatus("autopilot paused after repeated rate limits")
      setNotices((prev) => [
        ...prev,
        { kind: "system", text: `⟳ Autopilot paused after ${attempts} rate-limit retries over about ${total}.` },
      ])
      showToast("warning", "Autopilot paused", `Rate limited after ${attempts} retries over about ${total}.`, 8000)
      queueMicrotask(scrollBottom)
      return
    }

    autopilotRateLimitRetryCount++
    const attempt = autopilotRateLimitRetryCount
    const maxAttempts = AUTOPILOT_RATE_LIMIT_BACKOFF_MS.length
    const delayText = formatAutopilotRetryDelay(delayMs)
    const noticeTime = formatAutopilotNoticeTime()
    setStatus(`autopilot rate-limited — retrying in ${delayText}`)
    setNotices((prev) => [
      ...prev,
      { kind: "system", text: `⟳ Proactive Autopilot rate-limited; retry ${attempt}/${maxAttempts} in ${delayText}. (${noticeTime})` },
    ])
    showToast("warning", "Autopilot rate-limited", `Retry ${attempt}/${maxAttempts} in ${delayText}.`, 6000)
    queueMicrotask(scrollBottom)
    autopilotRateLimitTimer = setTimeout(() => {
      autopilotRateLimitTimer = undefined
      if (autopilotMode() !== "proactive") return
      void queueAutopilotContinuation()
    }, delayMs)
  }

  async function queueAutopilotContinuation() {
    if (!autopilotEnabled() || autopilotSupervisorRunning) return
    autopilotSupervisorRunning = true
    setStatus(`autopilot: deciding next step...`)
    try {
      const decision = await runAutopilotSupervisor()
      if (!autopilotEnabled()) return
      clearAutopilotRateLimitRetry()
      if (decision.confidence === "low") {
        setStatus("autopilot ready — waiting for your input")
        if (decision.reason) {
          setNotices((prev) => [...prev, { kind: "system", text: `⟳ Autopilot paused: ${decision.reason}` }])
          queueMicrotask(scrollBottom)
        }
        return
      }
      showToast("info", "Autopilot continuing", decision.instruction, 4000)
      inputQueue?.enqueue(decision.instruction)
      setStatus("autopilot queued next prompt")
      queueMicrotask(scrollBottom)
    } catch (err) {
      const isAbort = err instanceof Error && (err.name === "AbortError" || err.message === "aborted")
      if (!isAbort && autopilotEnabled()) {
        if (autopilotMode() === "proactive" && isRateLimitError(err)) {
          scheduleAutopilotRateLimitRetry()
          return
        }
        setStatus("autopilot ready — supervisor unavailable")
        setNotices((prev) => [...prev, { kind: "system", text: "⟳ Autopilot could not evaluate this response and is waiting for you." }])
        queueMicrotask(scrollBottom)
      }
    } finally {
      autopilotSupervisorRunning = false
    }
  }

  function scheduleAutopilotCheck() {
    if (!autopilotEnabled() || autopilotSupervisorRunning) return
    if (autopilotRateLimitTimer) return
    if (running() || compacting() || pendingApproval() || (inputQueue?.depth() ?? 0) > 0 || (inputQueue?.isDraining() ?? false)) return
    queueMicrotask(() => { void queueAutopilotContinuation() })
  }

  function configureAutopilot(mode: AutopilotMode) {
    autopilotAbort?.abort()
    autopilotAbort = undefined
    clearAutopilotRateLimitRetry()
    setAutopilotMode(mode)
    if (mode !== "off") {
      if (messages().length > 0) scheduleAutopilotCheck()
      else setStatus(`${mode} autopilot enabled — waiting for your first task`)
    } else {
      setStatus("autopilot disabled")
    }
  }

  const PALETTE_WIDTH = createMemo(() => Math.min(90, Math.max(52, Math.floor(dimensions().width * 0.38))))
  const PALETTE_INPUT_WIDTH = createMemo(() => Math.min(128, Math.max(PALETTE_WIDTH(), dimensions().width - 8)))
  const isPaletteTextEntryMode = () => paletteMode() === "rename" || paletteMode() === "maxSteps" || paletteMode() === "localVlmEndpoint" || paletteMode() === "localVlmModel" || paletteMode() === "addProviderKeyName" || paletteMode() === "addProviderKeyValue" || paletteMode() === "codexKeyname" || paletteMode() === "editProviderBaseURL"
  const activePaletteWidth = () => isPaletteTextEntryMode() ? PALETTE_INPUT_WIDTH() : PALETTE_WIDTH()
  const PALETTE_LABEL_MAX = createMemo(() => Math.floor(PALETTE_WIDTH() * 0.65))
  const PALETTE_HINT_MAX = createMemo(() => Math.floor(PALETTE_WIDTH() * 0.22))

  type PaletteItem = { label: string; hint?: string; onSelect: () => void; kind?: "item" | "section"; sessionId?: string; directoryPath?: string; queueItemId?: number }
  const paletteDeleteKey = (item: PaletteItem) => item.sessionId ?? null
  const isPalettePendingDelete = (item: PaletteItem) => {
    const key = paletteDeleteKey(item)
    return key !== null && palettePendingDelete() === key
  }

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

  const modelInfoLabel = createMemo(() => {
    selectionRevision()
    return currentModelInfo
  })

  const activeProviderKeyLabel = createMemo(() => {
    providerConfigRevision()
    return getActiveConfiguredProviderKeyName(currentProvider) ?? "none"
  })

  const applyProviderModel = (providerId: string, model: string, persist = false, modelInfo?: ModelInfo) => {
    try {
      const nextProvider = providerId
      const nextModel = nextProvider === "opencode-zen" ? normalizeBigPickleModel(model) : model
      currentLayer = Layer.merge(buildLayer(nextProvider, nextModel), toolLayer)
      currentProvider = nextProvider
      currentModel = nextModel
      currentModelInfo = modelInfo ?? getCachedModelInfo(nextProvider, nextModel)
      setSelectionRevision((value) => value + 1)
      if (persist) saveSession(sessionId(), messages(), currentModel, currentProvider, mode(), compaction(), permissionRules(), autoApprove())
      refreshSessions()
      return true
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  const loadModelsForProvider = async (providerId: string, options: { force?: boolean } = {}) => {
    if ((!options.force && providerModels()[providerId]) || providerModelsLoading() === providerId) return
    const cached = getCachedModels(providerId)
    if (cached.length > 0 && (!providerModels()[providerId] || options.force)) {
      setProviderModels((prev) => ({ ...prev, [providerId]: cached }))
      if (providerId === currentProvider) {
        currentModelInfo = cached.find((model) => model.id === currentModel) ?? currentModelInfo
        setSelectionRevision((value) => value + 1)
      }
    }
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
      const unique = setCachedModels(providerId, models)
      const resolved = unique.length > 0 ? unique : [{ id: defaultModel }]
      setProviderModels((prev) => ({ ...prev, [providerId]: resolved }))
      if (providerId === currentProvider) {
        currentModelInfo = resolved.find((model) => model.id === currentModel) ?? getCachedModelInfo(currentProvider, currentModel)
        setSelectionRevision((value) => value + 1)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setProviderModelsError((prev) => ({ ...prev, [providerId]: message }))
    } finally {
      setProviderModelsLoading((loading) => (loading === providerId ? null : loading))
    }
  }

  const ensureModelsForProvider = async (providerId: string) => {
    if (!providerModels()[providerId] && providerModelsLoading() !== providerId) {
      const cached = getCachedModels(providerId)
      if (cached.length > 0) {
        setProviderModels((prev) => ({ ...prev, [providerId]: cached }))
        if (providerId === currentProvider) {
          currentModelInfo = cached.find((model) => model.id === currentModel) ?? currentModelInfo
          setSelectionRevision((value) => value + 1)
        }
      } else {
        await loadModelsForProvider(providerId)
      }
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
    void loadModelsForProvider(providerId, { force: true })
  }

  const openProviderKeyPalette = (providerId: string) => {
    setPalettePendingDelete(null)
    setPaletteProviderKeyTarget(providerId)
    setPaletteMode("providerKeys")
    setPaletteIndex(0)
  }

  let pendingCodexBrowserAuth: Awaited<ReturnType<typeof startCodexBrowserAuthorization>> | undefined

  const markCodexAuthorized = () => {
    setProviderConfigRevision((value) => value + 1)
    setProviderModels((prev) => {
      const next = { ...prev }
      delete next["openai-codex"]
      return next
    })
    setStatus("Codex authorized")
  }

  const completeCodexAuthAndSwitch = async () => {
    setProviderConfigRevision((value) => value + 1)
    await ensureModelsForProvider("openai-codex")
    const model = defaultModelForCurrentProvider("openai-codex")
    const modelInfo = providerModels()["openai-codex"]?.find((entry) => entry.id === model)
    applyProviderModel("openai-codex", model, true, modelInfo)
    setStatus("Codex authorized — switched to openai-codex")
    setNotices((prev) => [...prev, {
      kind: "system",
      text: "Codex authorized! Using openai-codex provider with ChatGPT Pro/Plus.",
    }])
  }

  const runCodexLogin = async (method: "browser" | "headless" | "code" = "browser", value?: string) => {
    try {
      if (method === "code") {
        if (!pendingCodexBrowserAuth) {
          return { ok: false, message: "No pending browser authorization. Run /codex-login first, then paste the callback URL or code directly." }
        }
        if (!value?.trim()) {
          return { ok: false, message: "Usage: /codex-login code <callback-url-or-code>  (or just paste the URL directly)" }
        }
        await pendingCodexBrowserAuth.complete(value)
        pendingCodexBrowserAuth = undefined
        await completeCodexAuthAndSwitch()
        return { ok: true, message: "Codex authorization saved — switched to openai-codex." }
      }

      if (method === "browser") {
        const auth = await startCodexBrowserAuthorization()
        pendingCodexBrowserAuth = auth
        setNotices((prev) => [...prev, {
          kind: "system",
          text: `Complete Codex authorization in your browser. If it does not return automatically, paste the callback URL or authorization code here.`,
        }])
        setStatus("waiting for Codex browser authorization...")
        openExternalUrl(auth.url)
        void auth.waitForAuth().then(async () => {
          if (pendingCodexBrowserAuth !== auth) return // already handled by paste
          pendingCodexBrowserAuth = undefined
          await completeCodexAuthAndSwitch()
        }).catch((error) => {
          if (pendingCodexBrowserAuth === auth) pendingCodexBrowserAuth = undefined
          setStatus("Codex authorization failed")
          setNotices((prev) => [...prev, { kind: "error", text: error instanceof Error ? error.message : String(error) }])
        })
        return { ok: true, message: `Browser opened for Codex authorization. Paste the callback URL here to complete if it doesn't auto-close.` }
      } else {
        const device = await startCodexDeviceAuthorization()
        setNotices((prev) => [...prev, {
          kind: "system",
          text: `Open ${device.url} and enter code: ${device.userCode}`,
        }])
        setStatus("waiting for Codex device authorization...")
        await device.waitForAuth()
      }

      await completeCodexAuthAndSwitch()
      return { ok: true, message: "Codex authorization saved — switched to openai-codex." }
    } catch (error) {
      setStatus("Codex authorization failed")
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  const completeXaiAuthAndSwitch = async () => {
    setProviderConfigRevision((value) => value + 1)
    setProviderModels((prev) => {
      const next = { ...prev }
      delete next["xai-oauth"]
      return next
    })
    await ensureModelsForProvider("xai-oauth")
    const model = defaultModelForCurrentProvider("xai-oauth")
    const modelInfo = providerModels()["xai-oauth"]?.find((entry) => entry.id === model)
    applyProviderModel("xai-oauth", model, true, modelInfo)
    setStatus("xAI authorized — switched to xai-oauth")
    setNotices((prev) => [...prev, {
      kind: "system",
      text: "xAI authorized! Using xai-oauth provider with SuperGrok / X Premium+.",
    }])
  }

  const runXaiLogin = async () => {
    try {
      const device = await startXaiDeviceAuthorization()
      setNotices((prev) => [...prev, {
        kind: "system",
        text: `Open ${device.url} and approve xAI access. If prompted, enter code: ${device.userCode}`,
      }])
      setStatus("waiting for xAI device authorization...")
      openExternalUrl(device.url)
      await device.waitForAuth()
      await completeXaiAuthAndSwitch()
      return { ok: true, message: "xAI authorization saved — switched to xai-oauth." }
    } catch (error) {
      setStatus("xAI authorization failed")
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
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
      const text = contentToText(msg.content).replace(/\n/g, " ").slice(0, 50);
      const isActive = i === timelineTargetMsgIdx();
      items.push({
        label: (isActive ? ">" : " ") + " " + text,
        hint: `msg #${i + 1}`,
        onSelect: () => {
          setTimelineTargetMsgIdx(i);
          // Open unified message actions (Revert / Copy / Fork)
          const actualIdx = messages().indexOf(msg)
          if (actualIdx >= 0) {
            setUserMsgActionTarget({ index: actualIdx, text: contentToText(msg.content) })
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
    geassRevision()
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
        label: "Autopilot",
        hint: autopilotMode() === "off" ? "OFF" : autopilotMode().toUpperCase(),
        onSelect: () => {
          setPaletteMode("autopilot")
          setPaletteIndex(1)
        },
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
        label: "Max steps",
        hint: String(maxSteps()),
        onSelect: () => {
          setPaletteInput(String(maxSteps()))
          setPaletteMode("maxSteps")
          setPaletteIndex(0)
        },
      },
      {
        label: "Reload",
        hint: "check state, reload config & detect file changes",
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
          setGitRefreshRevision(v => v + 1)
          // Check for modified/new/deleted files that may have been changed externally
          getGitFileChanges().then(({ modified, added, deleted }) => {
            const hints: string[] = []
            if (modified.length > 0) hints.push(`${modified.length} modified`)
            if (added.length > 0) hints.push(`${added.length} added`)
            if (deleted.length > 0) hints.push(`${deleted.length} deleted`)
            if (hints.length > 0) {
              setStatus(`reload: ${hints.join(", ")}`)
            } else {
              setStatus("reload complete")
            }
          })
          setShowPalette(false)
        },
      },
      {
        label: "GIT",
        kind: "section",
        onSelect: () => {},
      },
      {
        label: "Refresh modified files",
        hint: "force re-read git working tree state",
        onSelect: () => {
          setGitRefreshRevision(v => v + 1)
          setStatus("refreshing modified files…")
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
        onSelect: () => { setPalettePendingDelete(null); setPaletteIndex(0); setSessionScope("cwd"); setPaletteMode("sessions") },
      },
      {
        label: "Change directory",
        hint: truncateText(displayPath(currentCwd()), PALETTE_HINT_MAX()),
        onSelect: () => {
          setPalettePendingDelete(null)
          setPaletteInput("")
          setPaletteIndex(0)
          setPaletteMode("directories")
        },
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
        hint: "/compact",
        onSelect: () => {
          setShowPalette(false)
          void compactCurrentSession()
        },
      },
      {
        label: "Auto compression",
        hint: autoCompressionEnabled() ? "ON · compact before context gets full" : "OFF",
        onSelect: () => {
          const nextEnabled = !autoCompressionEnabled()
          setAutoCompressionEnabled(nextEnabled)
          saveUIPrefs({ autoCompressionEnabled: nextEnabled })
          setStatus(nextEnabled ? "auto compression enabled" : "auto compression disabled")
          setShowPalette(false)
        },
      },
      ...(compaction()?.summary
        ? [{
            label: "View compaction summary",
            hint: "/compact view",
            onSelect: () => {
              viewCompactionSummary()
            },
          } satisfies PaletteItem]
        : []),
      {
        label: "Export compact transcript",
        hint: "/export",
        onSelect: () => {
          exportCompactSession()
          setShowPalette(false)
        },
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
        label: "Queued messages",
        hint: queuedInputs() > 0 ? `${queuedInputs()} waiting` : "none",
        onSelect: openQueuedMessagesPalette,
      },
      {
        label: "USAGE",
        kind: "section",
        onSelect: () => {},
      },
      {
        label: "Usage dashboard",
        hint: "tokens by session / provider / model",
        onSelect: () => { setShowPalette(false); setShowUsageDashboard(true) },
      },
      {
        label: "Experiment",
        hint: "VLM, GEASS, tools …",
        onSelect: () => {
          setPalettePendingDelete(null)
          setPaletteMode("experiments")
          setPaletteIndex(0)
        },
      },
      {
        label: "MODEL",
        kind: "section",
        onSelect: () => {},
      },
      {
        label: "Switch mode",
        hint: mode() === "build" ? "build → plan" : mode() === "plan" ? "plan → compose" : "compose → build",
        onSelect: () => {
          setMode(m => m === "build" ? "plan" : m === "plan" ? "compose" : "build")
          setShowPalette(false)
        },
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
        hint: truncateText(modelLabel(), PALETTE_HINT_MAX()),
        onSelect: () => openModelsPalette(providerLabel(), "actions"),
      },
    ]
  })

  const sessionPaletteItems = createMemo<PaletteItem[]>(() => {
    sessionRevision()
    lockPollRevision()
    const sid = sessionId()
    const sessions = listSessions({ directory: sessionScope() === "global" ? null : currentCwd() })
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

  const directoryPaletteItems = createMemo<PaletteItem[]>(() => {
    cwdRevision()
    const input = paletteInput()
    const target = resolveDirectoryPath(input, currentCwd())
    const candidates = directoryCandidates(input, currentCwd())
    const items: PaletteItem[] = []

    items.push({
      label: `Current: ${displayPath(currentCwd())}`,
      kind: "section",
      onSelect: () => {},
    })

    if (input.trim() && isDirectory(target)) {
      items.push({
        label: `Use ${displayPath(target)}`,
        hint: "Enter",
        directoryPath: target,
        onSelect: () => {
          const result = doChangeDirectory(target)
          if (!result.ok) setStatus(result.message)
        },
      })
    }

    for (const candidate of candidates) {
      items.push({
        label: candidate.name,
        hint: truncateText(displayPath(candidate.path), PALETTE_HINT_MAX()),
        directoryPath: candidate.path,
        onSelect: () => {
          setPaletteInput(displayPath(candidate.path) + "/")
          setPaletteIndex(0)
        },
      })
    }

    if (candidates.length === 0 && !isDirectory(target)) {
      items.push({ label: "No matching directories", kind: "section", onSelect: () => {} })
    }

    items.push({ label: "", onSelect: () => {} })
    items.push({
      label: "← Back",
      onSelect: () => {
        setPaletteInput("")
        setPaletteMode("actions")
        setPaletteIndex(firstSelectablePaletteIndex(actionPaletteItems()))
      },
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
      hint: truncateText(provider.id, PALETTE_HINT_MAX()),
      onSelect: () => {
        openProviderKeyPalette(provider.id)
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
      : models.filter((model) => model.id.toLowerCase().includes(filter))
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

    if (models.length > 0) {
      items.push({
        label: loading
          ? (filter
            ? `Refreshing; showing ${visibleModels.length} / ${filteredModels.length} cached match(es)`
            : `Refreshing; showing ${visibleModels.length} / ${models.length} cached model(s)`)
          : filter
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

    for (const modelInfo of visibleModels) {
      const model = modelInfo.id
      const isCurrent = providerId === providerLabel() && model === modelLabel()
      items.push({
        label: `${isCurrent ? ">" : " "} ${model}`,
        hint: truncateText(modelHint(model, modelInfo), PALETTE_HINT_MAX()),
        onSelect: () => {
          if (!applyProviderModel(providerId, model, true, modelInfo)) return
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

    const provider = PROVIDERS[providerId]
    const envKeys = provider?.envKeys?.filter((key) => Boolean(process.env[key])) ?? []
    const detectedAuth = provider?.detectAuth?.() ?? false

    if (envKeys.length > 0) {
      items.push({
        label: `Env key active`,
        hint: envKeys.join(", "),
        kind: "section",
        onSelect: () => {},
      })
    }

    if (providerId === "openai-codex") {
      // List all stored Codex auth entries
      const authEntries = listCodexAuths()
      if (authEntries.length > 0) {
        for (const entry of authEntries) {
          const isActive = entry.isActive && currentProvider === "openai-codex"
          const displayLabel = entry.keyname
            ? entry.keyname
            : entry.auth.accountId
              ? `Account: ${entry.auth.accountId.slice(0, 12)}`
              : `Key: ${entry.tokenPreview}`
          items.push({
            label: `${isActive ? ">" : " "} ${displayLabel}${entry.isActive ? " (active)" : ""}`,
            hint: entry.tokenPreview,
            sessionId: entry.label,
            onSelect: async () => {
              if (!entry.isActive) {
                activateCodexAuth(entry.label)
                setProviderConfigRevision((value) => value + 1)
              }
              await ensureModelsForProvider("openai-codex")
              const model = defaultModelForCurrentProvider("openai-codex")
              const modelInfo = providerModels()["openai-codex"]?.find((entry) => entry.id === model)
              if (!applyProviderModel("openai-codex", model, true, modelInfo)) {
                setStatus("Failed to activate Codex auth")
                return
              }
              setStatus("Codex activated")
              setShowPalette(false)
              setPaletteMode("actions")
            },
          })
          items.push({
            label: `  ${entry.keyname ? `Rename "${entry.keyname}"` : "Set key name..."}`,
            hint: entry.label,
            onSelect: () => {
              setPaletteCodexKeynameTarget(entry.label)
              setPaletteInput(entry.keyname ?? "")
              setPaletteMode("codexKeyname")
            },
          })
        }
      } else {
        items.push({
          label: "Codex auth missing",
          hint: "run /codex-login",
          kind: "section",
          onSelect: () => {},
        })
      }
    }

    if (providerId === "xai-oauth") {
      if (detectedAuth || hasXaiAuth()) {
        items.push({
          label: `${currentProvider === "xai-oauth" ? ">" : " "} SuperGrok / X Premium+ OAuth`,
          hint: "active",
          sessionId: "xai-oauth",
          onSelect: async () => {
            await ensureModelsForProvider("xai-oauth")
            const model = defaultModelForCurrentProvider("xai-oauth")
            const modelInfo = providerModels()["xai-oauth"]?.find((entry) => entry.id === model)
            if (!applyProviderModel("xai-oauth", model, true, modelInfo)) {
              setStatus("Failed to activate xAI auth")
              return
            }
            setStatus("xAI activated")
            setShowPalette(false)
            setPaletteMode("actions")
          },
        })
      } else {
        items.push({
          label: "xAI auth missing",
          hint: "run /xai-login",
          kind: "section",
          onSelect: () => {},
        })
      }
    }

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
    if (providerId === "openai-codex") {
      items.push({
        label: detectedAuth ? "Re-authorize Codex (browser)" : "Authorize ChatGPT Pro/Plus (browser)",
        hint: "oauth",
        onSelect: async () => {
          const result = await runCodexLogin("browser")
          showToast(result.ok ? "success" : "error", result.ok ? "Codex login started" : "Codex login failed", result.message)
        },
      })
      items.push({
        label: "Manually enter API Key",
        hint: "OpenAI provider",
        onSelect: () => {
          setPaletteProviderKeyTarget("openai")
          setPaletteInput("")
          setPaletteMode("addProviderKeyName")
          setPaletteIndex(0)
        },
      })
    }
    if (providerId === "xai-oauth") {
      items.push({
        label: detectedAuth ? "Re-authorize xAI Grok (device)" : "Authorize SuperGrok / X Premium+ (device)",
        hint: "oauth",
        onSelect: async () => {
          const result = await runXaiLogin()
          showToast(result.ok ? "success" : "error", result.ok ? "xAI login completed" : "xAI login failed", result.message)
        },
      })
    }
    items.push({
      label: "Continue to models",
      hint: keys.length > 0
        ? `using ${active ?? keys[0]}`
        : envKeys.length > 0
          ? "using env"
          : detectedAuth
            ? "using oauth"
            : providerId === "openai-codex" || providerId === "xai-oauth"
              ? "authorize first"
              : provider?.authOptional
                ? "no key"
                : "no key configured",
      onSelect: () => {
        if (providerId === "openai-codex" && !detectedAuth) {
          setStatus("Authorize Codex before choosing a model")
          return
        }
        if (providerId === "xai-oauth" && !detectedAuth) {
          setStatus("Authorize xAI before choosing a model")
          return
        }
        if (!provider?.authOptional && keys.length === 0 && envKeys.length === 0 && !detectedAuth) {
          setStatus(`Add a key for ${providerId} before choosing a model`)
          return
        }
        openModelsPalette(providerId, "providers")
      },
    })
    items.push({ label: "", onSelect: () => {} })
    if (providerId !== "openai-codex" && providerId !== "xai-oauth") {
      items.push({
        label: "Add key...",
        onSelect: () => {
          setPaletteNewKeyName("")
          setPaletteInput("")
          setPaletteMode("addProviderKeyName")
          setPaletteIndex(0)
        },
      })
    }
    {
      const currentBaseURL = getStoredProviderConfig(providerId)?.baseURL
      items.push({
        label: "Edit base URL...",
        hint: currentBaseURL ?? "default",
        onSelect: () => {
          setPaletteInput(currentBaseURL ?? "")
          setPaletteMode("editProviderBaseURL")
          setPaletteIndex(0)
        },
      })
      items.push({ label: "", onSelect: () => {} })
    }
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

  
  const experimentPaletteItems = createMemo<PaletteItem[]>(() => {
    geassRevision()
    // Selectable groups derived from loaded tools, plus configured-but-not-yet-
    // loaded MCP servers so the user can enable them from here.
    const builtinGroups = listSelectableGroups(registeredTools(), disabledToolGroups())
    const seen = new Set(builtinGroups.map((g) => g.id))
    const mcpExtra = getConfiguredServers()
      .map((s) => mcpGroupId(s.id))
      .filter((gid) => !seen.has(gid))
      .map((gid) => ({
        id: gid,
        label: TOOL_GROUPS[gid]?.label ?? gid,
        description: TOOL_GROUPS[gid]?.description ?? "",
        count: 0,
        // MCP groups are opt-in: enabled state comes from the allowlist, not the
        // builtin denylist. A loaded server already appears in builtinGroups.
        enabled: enabledMcpServers().includes(gid.slice("mcp:".length)),
      }))
    const groups = [...builtinGroups, ...mcpExtra]

    const toggleGroupItem = (g: { id: string; label: string; count: number; enabled: boolean }) => {
      if (g.id.startsWith("mcp:")) {
        const serverId = g.id.slice("mcp:".length)
        const server = getConfiguredServers().find((s) => s.id === serverId)
        const nowEnabled = !enabledMcpServers().includes(serverId)
        const nextList = nowEnabled
          ? [...enabledMcpServers(), serverId]
          : enabledMcpServers().filter((s) => s !== serverId)
        setEnabledMcpServers(nextList)
        saveUIPrefs({ enabledMcpServers: nextList })
        if (nowEnabled && server && !isServerLoaded(serverId) && !isServerLoading(serverId)) {
          setStatus(`starting MCP ${serverId}...`)
          loadMcpServer(server)
            .then((n) => { refreshRegisteredTools(); setStatus(`MCP ${serverId}: ${n} tools loaded`) })
            .catch((e) => setStatus(`MCP ${serverId} failed: ${e instanceof Error ? e.message : String(e)}`))
        } else if (!nowEnabled && isServerLoaded(serverId)) {
          unloadMcpServer(serverId)
          refreshRegisteredTools()
          setStatus(`${g.label} disabled`)
        }
        return
      }
      const next = toggleGroup(disabledToolGroups(), g.id)
      setDisabledToolGroups(next)
      saveUIPrefs({ disabledToolGroups: next })
      const nowEnabled = !next.includes(g.id)
      if (g.id === "browser") {
        setEnabled(nowEnabled)
        setGeassRevision((v) => v + 1)
        if (nowEnabled) testConnection().then(() => setGeassRevision((v) => v + 1))
      }
      setStatus(nowEnabled ? `${g.label} enabled` : `${g.label} disabled`)
    }

    return [
      {
        label: "EXPERIMENTS",
        kind: "section",
        onSelect: () => {},
      },
      {
        label: "Force local VLM for vision",
        hint: forceLocalVlm() ? "ON · image tools use local VLM" : "OFF · native vision when available",
        onSelect: () => {
          const nextEnabled = !forceLocalVlm()
          setForceLocalVlm(nextEnabled)
          setStatus(nextEnabled ? "local VLM forced for image analysis" : "local VLM force disabled")
        },
      },
      {
        label: "Local VLM endpoint",
        hint: localVlmEndpoint() || getDefaultLocalVlmEndpoint(),
        onSelect: () => {
          setPaletteInput(localVlmEndpoint() || getDefaultLocalVlmEndpoint())
          setPaletteMode("localVlmEndpoint")
          setPaletteIndex(0)
        },
      },
      {
        label: "Local VLM model",
        hint: localVlmModel() || getDefaultLocalVlmModel(),
        onSelect: () => {
          setPaletteInput(localVlmModel() || getDefaultLocalVlmModel())
          setPaletteMode("localVlmModel")
          setPaletteIndex(0)
        },
      },
      {
        label: "TOOLS",
        kind: "section",
        onSelect: () => {},
      },
      ...groups.map((g) => ({
        // Toggling a group keeps the palette open so several can be flipped in
        // one visit. The Browser group also drives the GEASS connection; MCP
        // groups spawn/stop their server on toggle.
        label: g.enabled ? `✓ ${g.label}` : `  ${g.label}`,
        hint: g.id === "browser"
          ? (g.enabled ? (isConnected() ? "on · ● Online" : "on · ○ Offline") : "off · hidden from model")
          : g.id.startsWith("mcp:")
            ? (g.enabled ? (g.count > 0 ? `on · ${g.count} tools` : "on · starting…") : "off · server stopped")
            : (g.enabled ? `on · ${g.count} tool${g.count === 1 ? "" : "s"}` : "off · hidden from model"),
        onSelect: () => toggleGroupItem(g),
      })),
      ...(!disabledToolGroups().includes("browser") ? [{
        label: "Test GEASS connection",
        hint: isConnected() ? "● Online" : "○ Offline",
        onSelect: () => {
          testConnection().then(ok => {
            setGeassRevision(v => v + 1)
            setStatus(ok ? "GEASS connected" : "GEASS connection failed")
          })
        },
      }] : []),
      { label: "", onSelect: () => {} },
      {
        label: "← Back",
        onSelect: () => {
          setPaletteMode("actions")
          setPaletteIndex(firstSelectablePaletteIndex(actionPaletteItems()))
        },
      },
    ]
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
          if (target) {
            await copyToClipboard(target.text)
            showToast("success", "Copied to clipboard", truncateText(target.text.replace(/\s+/g, " ").trim(), 60), 2000)
          }
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

  const queuedMessagePaletteItems = createMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = []
    const queued = queuedInputItems()

    if (queued.length === 0) {
      items.push({ label: "No queued messages", kind: "section", onSelect: () => {} })
    } else {
      items.push({ label: `${queued.length} message${queued.length === 1 ? "" : "s"} waiting`, kind: "section", onSelect: () => {} })
      for (const item of queued) {
        const preview = truncateText(item.text.replace(/\s+/g, " ").trim(), PALETTE_LABEL_MAX())
        items.push({
          label: preview || "(empty message)",
          hint: "Enter cancel",
          queueItemId: item.id,
          onSelect: () => {
            const ok = inputQueue.cancel(item.id)
            setStatus(ok ? `cancelled queued message (${inputQueue.depth()} queued)` : "queued message already started")
            setQueuedInputItems(inputQueue.pendingItems())
            if (inputQueue.depth() === 0) setShowPalette(false)
          },
        })
      }
      items.push({ label: "", kind: "section", onSelect: () => {} })
      items.push({
        label: "Cancel all queued messages",
        hint: `Enter (${queued.length})`,
        queueItemId: -1,
        onSelect: () => {
          const count = inputQueue.clear()
          setStatus(count > 0 ? `cancelled ${count} queued message${count === 1 ? "" : "s"}` : "no queued messages")
          setQueuedInputItems(inputQueue.pendingItems())
          setShowPalette(false)
        },
      })
    }

    return items
  })

  const autopilotPaletteItems = createMemo<PaletteItem[]>(() => {
    const current = autopilotMode()
    const selectMode = (mode: AutopilotMode) => {
      configureAutopilot(mode)
      setShowPalette(false)
      showToast(
        "success",
        mode === "off" ? "Autopilot stopped" : mode === "proactive" ? "Proactive Autopilot enabled" : "Standard Autopilot enabled",
        mode === "off"
          ? "AI will wait for your next message."
          : mode === "proactive"
            ? "AI will continue work aligned with the existing plan, pause on uncertainty, and retry rate limits."
            : "AI will answer routine continuation questions when the next step is clear and safe.",
      )
    }
    return [
      {
        label: `Current: ${current}`,
        kind: "section",
        onSelect: () => {},
      },
      {
        label: "Standard",
        hint: "routine continuation",
        onSelect: () => selectMode("standard"),
      },
      {
        label: "Proactive",
        hint: "plan-aligned continuation",
        onSelect: () => selectMode("proactive"),
      },
      ...(current !== "off"
        ? [{ label: "Turn off", hint: "wait for input", onSelect: () => selectMode("off") } satisfies PaletteItem]
        : []),
    ]
  })

  const paletteItems = createMemo<PaletteItem[]>(() =>
    paletteMode() === "maxSteps"
      ? [
          { label: `Current max steps: ${maxSteps()}`, kind: "section" as const, onSelect: () => {} },
          { label: "Press Enter to save · Esc to cancel", kind: "section" as const, onSelect: () => {} },
        ]
      : paletteMode() === "editProviderBaseURL"
      ? [
          { label: `Provider: ${paletteProviderKeyTarget()}`, kind: "section" as const, onSelect: () => {} },
          { label: "Press Enter to save · Esc to cancel · leave blank for default", kind: "section" as const, onSelect: () => {} },
        ]
      : paletteMode() === "localVlmEndpoint"
      ? [
          { label: `Current: ${localVlmEndpoint() || getDefaultLocalVlmEndpoint()}`, kind: "section" as const, onSelect: () => {} },
          { label: "Press Enter to save · Esc to cancel", kind: "section" as const, onSelect: () => {} },
        ]
      : paletteMode() === "localVlmModel"
      ? [
          { label: `Current: ${localVlmModel() || getDefaultLocalVlmModel()}`, kind: "section" as const, onSelect: () => {} },
          { label: "Press Enter to save · Esc to cancel", kind: "section" as const, onSelect: () => {} },
        ]
      : paletteMode() === "sessions"
      ? sessionPaletteItems()
      : paletteMode() === "autopilot"
        ? autopilotPaletteItems()
      : paletteMode() === "directories"
        ? directoryPaletteItems()
      : paletteMode() === "providers"
        ? providerPaletteItems()
        : paletteMode() === "models"
          ? modelPaletteItems()
          : paletteMode() === "providerKeys"
            ? providerKeyPaletteItems()
          : paletteMode() === "timeline"
            ? timelinePaletteItems()
          : paletteMode() === "queuedMessages"
            ? queuedMessagePaletteItems()
          : paletteMode() === "display"
            ? displayPaletteItems()
          : paletteMode() === "experiments"
            ? experimentPaletteItems()
          : paletteMode() === "userMessageActions"
            ? userMessageActionItems()
          : actionPaletteItems(),
  )

  const filteredPaletteItems = createMemo<PaletteItem[]>(() => {
    const items = paletteItems()
    // rename mode: paletteInput is the name text, not a filter
    // models mode: handles its own filtering internally
    // queuedMessages is intentionally unfiltered; the queue is small and simpler without search input
    if (paletteMode() === "rename" || paletteMode() === "directories" || paletteMode() === "models" || paletteMode() === "queuedMessages" || paletteMode() === "maxSteps" || paletteMode() === "localVlmEndpoint" || paletteMode() === "localVlmModel" || paletteMode() === "addProviderKeyName" || paletteMode() === "addProviderKeyValue" || paletteMode() === "codexKeyname" || paletteMode() === "editProviderBaseURL") return items
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
    if (mode !== "rename" && mode !== "directories" && mode !== "models" && mode !== "maxSteps" && mode !== "localVlmEndpoint" && mode !== "localVlmModel" && mode !== "addProviderKeyName" && mode !== "addProviderKeyValue" && mode !== "codexKeyname" && mode !== "editProviderBaseURL") {
      setPaletteInput("")
    }
  })

  // Keep palette index valid when filter narrows the visible items
  createEffect(() => {
    if (paletteMode() === "rename" || paletteMode() === "directories" || paletteMode() === "models" || paletteMode() === "maxSteps" || paletteMode() === "localVlmEndpoint" || paletteMode() === "localVlmModel" || paletteMode() === "addProviderKeyName" || paletteMode() === "addProviderKeyValue" || paletteMode() === "codexKeyname" || paletteMode() === "editProviderBaseURL") return
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

  // Poll lock status while session list palette is open.
  // A slower interval reduces idle CPU wakeups without materially affecting UX.
  createEffect(() => {
    if (!showPalette()) return
    if (paletteMode() !== "sessions") return
    const id = setInterval(() => setLockPollRevision(v => v + 1), 5000)
    return () => clearInterval(id)
  })

  const turns = createMemo(() => {
    selectionRevision()
    const result: DisplayTurn[] = []
    const footerText = () => `${truncateText(providerLabel(), 12)}/${truncateText(modelLabel(), 28)}  •  select text to copy (${formatAutopilotNoticeTime()})`
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

    const info = compaction()
    if (info) {
      result.push({ entries: [{ kind: "system", text: formatCompactionMarker(info) }] })
    }

    const allMsgs = messages()
    for (let msgIdx = 0; msgIdx < allMsgs.length; msgIdx++) {
      const msg = allMsgs[msgIdx]
      if (msg.role === "user" && msg.content) {
        result.push({
          user: { kind: "user", text: contentToText(msg.content) },
          entries: [],
          userMsgIndex: msgIdx,
          peerOrigin: msg.origin?.peer,
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
  const sidebarWidth = createMemo(() => sidebarWidthForTerminal(dimensions().width))
  const overlaySidebarWidth = createMemo(() => Math.max(24, Math.min(sidebarWidth(), dimensions().width - 4)))

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
        case "image":
          return { kind: "system", text: `[image: ${part.mimeType}]`, streaming: true } satisfies DisplayBlock
      }
    }).filter(Boolean) as DisplayBlock[],
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
      unloadAllMcpServers()
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
    showToast("success", "Copied to clipboard", truncateText(text.replace(/\s+/g, " ").trim(), 60), 2000)
  }

  const doSaveCurrent = () => {
    const id = sessionId()
    const msgs = messages()
    if (msgs.length === 0 && isDefaultTitle(sessionMeta()?.title ?? "")) return
    saveSession(id, msgs, currentModel, currentProvider, mode(), compaction(), permissionRules(), autoApprove())
  }

  const exportCompactSession = () => {
    try {
      const path = writeCompactTranscriptExport({
        sessionId: sessionId(),
        title: sessionMeta()?.title,
        compaction: compaction(),
        messages: messages(),
      })
      setStatus(`exported compact transcript: ${path}`)
      showToast("success", "Session exported", path, 5000)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus("session export failed")
      showToast("error", "Session export failed", message)
    }
  }

  const refreshSessions = () => {
    setSessionMeta(currentSessionMeta())
    setSessionRevision((v) => v + 1)
  }

  const doSwitchSession = (id: string) => {
    if (running() || compacting()) {
      setStatus("cannot switch sessions while busy")
      showToast("info", "Session busy", "Please wait for the current response or compaction to finish.")
      return
    }
    doSaveCurrent()
    const loaded = loadSessionState(id)
    if (loaded?.provider && loaded.model) {
      applyProviderModel(loaded.provider, loaded.model)
    } else {
      // No provider/model in session — UI labels still need refreshing
      setSelectionRevision((v) => v + 1)
    }
    setMessages(loaded?.messages ?? [])
    setMode(loaded?.mode === "plan" || loaded?.mode === "compose" ? loaded.mode : "build")
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

  const enterWorkspace = () => {
    setShowSplash(false)
    setPaletteInput("")
    setPalettePendingDelete(null)
    setPaletteMode("actions")
    renderer.setTerminalTitle("openzerocode")
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
    setComposerText(contentToText(targetMsg.content))
    setDraft(contentToText(targetMsg.content))
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
    if (running() || compacting()) {
      setStatus("cannot create a session while busy")
      showToast("info", "Session busy", "Please wait for the current response or compaction to finish.")
      return
    }
    doSaveCurrent()
    const meta = createSession(currentModel, currentProvider)
    setSessionId(meta.id)
    setSessionMeta(meta)
    setSessionRevision((v) => v + 1)
    setMessages([])
    setNotices([])
    setTodos([])
    setPermissionRules([])
    setCompaction(undefined)
    setAutoApprove(false)
    setComposerText("")
    setDraft("")
    setStatus("waiting for input")
    enterWorkspace()
  }

  const selectInitialSplashRow = () => {
    const sessions = listSessions({ directory: process.cwd() })
    setSplashSelectedIndex(sessions.length > 0 ? 0 : -1)
  }

  createEffect(() => {
    if (!showSplash()) return
    const recentCount = splashRecentSessions().length
    const exitIdx = recentCount
    const selected = splashSelectedIndex()
    if (recentCount === 0 && selected !== -1) {
      setSplashSelectedIndex(-1)
    } else if (recentCount > 0 && selected > exitIdx) {
      setSplashSelectedIndex(exitIdx)
    }
  })

  const doChangeDirectory = (path: string) => {
    if (running() || compacting()) return { ok: false, message: "Cannot change directory while a response or compaction is running." }
    const next = resolveDirectoryPath(path, currentCwd())
    if (!isDirectory(next)) return { ok: false, message: `Directory not found: ${path}` }

    doSaveCurrent()
    try {
      process.chdir(next)
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }

    refreshAgentsInstruction()
    setNotices([])
    setComposerText("")
    setDraft("")
    setPaletteInput("")
    setPalettePendingDelete(null)
    setPaletteMode("actions")
    setShowPalette(false)
    setShowSplash(true)
    setStatus("waiting for input")
    setCwdRevision((value) => value + 1)
    setSessionRevision((value) => value + 1)
    selectInitialSplashRow()
    setGitRefreshRevision((value) => value + 1)
    renderer.setTerminalTitle("openzerocode")
    return { ok: true, message: `Directory switched to ${displayPath(next)}` }
  }

  const viewCompactionSummary = () => {
    const info = compaction()
    if (!info || !info.summary) {
      setStatus("no compaction summary yet")
      showToast("info", "No compaction summary", "This session hasn't been compacted yet.")
      return
    }
    const createdAt = new Date(info.createdAt)
    const when = Number.isNaN(createdAt.getTime())
      ? ""
      : ` (${createdAt.toLocaleString()})`
    const header = `↯ Compaction summary · ${info.sourceMessageCount} messages summarized${when}`
    setNotices((prev) => [...prev, { kind: "system", text: `${header}\n\n${info.summary}` }])
    setShowPalette(false)
    queueMicrotask(scrollBottom)
  }

  const compactCurrentSession = async (opts: { automatic?: boolean } = {}) => {
    if (running()) {
      setStatus("response running — compaction skipped")
      if (!opts.automatic) showToast("info", "Compaction skipped", "A response is already running.")
      return
    }
    if (compacting()) {
      setStatus("compaction already running")
      if (!opts.automatic) showToast("info", "Compaction running", "Please wait for the current compaction to finish.")
      return
    }

    const currentMessages = messages()
    const { head, tail } = selectCompactionTail(currentMessages, getModelConfig(currentModel, currentModelInfo).contextLimit)
    if (head.length === 0) {
      if (!opts.automatic) {
        setStatus("session too short to compact")
        showToast("info", "Compaction skipped", "Session is still too short to compact.")
      }
      return
    }

    setPalettePendingDelete(null)
    setShowPalette(false)
    setCompacting(true)
    setStatus(opts.automatic ? `auto-compacting ${head.length} earlier messages...` : `compacting ${head.length} earlier messages...`)
    showToast("info", opts.automatic ? "Auto compression started" : "Compaction started", "Summarizing earlier session history…", 2000)
    queueMicrotask(scrollBottom)

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
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: `Summarize this earlier session history for compaction:\n\n${transcript}` },
          ],
        })
      }))

      const summary = contentToText(result.message.content).trim()
      if (!summary) {
        setStatus("compaction failed")
        showToast("error", "Compaction failed", "The provider returned an empty summary.")
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
      setStatus(opts.automatic ? "session auto-compressed" : "session compacted")
      showToast("success", opts.automatic ? "Session auto-compressed" : "Session compacted", `Compressed ${head.length} earlier messages into a summary.`)
    } catch (error) {
      const errorText = formatProviderError(error)
      setStatus(opts.automatic ? "auto compression failed" : "compaction failed")
      showToast("error", opts.automatic ? "Auto compression failed" : "Compaction failed", errorText)
      setNotices((prev) => [...prev, { kind: "error", text: errorText }])
    } finally {
      setCompacting(false)
      notifyCompactionIdle()
    }
  }

  const maybeAutoCompactContext = async (extraInput: string, opts: { warnWhenDisabled?: boolean } = {}) => {
    const cfg = getModelConfig(currentModel, currentModelInfo)
    const nearContextLimit = shouldAutoCompactContext(messages(), extraInput, cfg.contextLimit)
    if (nearContextLimit && autoCompressionEnabled()) {
      await compactCurrentSession({ automatic: true })
    } else if (nearContextLimit && opts.warnWhenDisabled) {
      setNotices((prev) => {
        const text = "Context is getting full — you can run /compact now if you want to reduce session history."
        const alreadyPresent = prev.some((notice) => notice.kind === "system" && notice.text === text)
        if (!alreadyPresent) showToast("warning", "Context getting full", "You can run /compact now to reduce session history.", 4500)
        return alreadyPresent ? prev : [...prev, { kind: "system", text }]
      })
    }
  }

  const runQueuedPrompt = async (rawInput: string, abortSignal: AbortSignal) => {
    if (compacting()) {
      setStatus(formatQueueStatus("waiting for compaction...", queuedInputs()))
      await waitForCompactionToFinish(abortSignal)
      if (abortSignal.aborted) return
    }

    const { text: input, peerOrigin, peerHop, samePairRoundtrips, oneWay } = decodePeerInput(rawInput)
    // Update peer context so call_peer tool knows our name, peer origin, and current hop state.
    setPeerContext(activePeerName, peerHop ?? 0, peerOrigin, samePairRoundtrips ?? 0)

    history = [input, ...history.filter((item) => item !== input)].slice(0, 100)
    historyIndex = -1
    historyDraft = ""

    // Auto-title: if this is the first user message and title is still default, derive from input
    if (messages().length === 0) {
      const meta = currentSessionMeta()
      if (meta && isDefaultTitle(meta.title)) {
        const title = deriveTitle(input)
        if (title) {
          updateSessionMeta(meta.id, { title })
          refreshSessions()
        }
      }
    }

    queueMicrotask(scrollBottom)

    await maybeAutoCompactContext(input, { warnWhenDisabled: true })

    if (abortSignal.aborted) return

    runAbort = new AbortController()
    abortSignal.addEventListener("abort", () => runAbort?.abort(), { once: true })
    streamState.reset()
    refreshAgentsInstruction()
    setRunning(true)
    setStatus(formatQueueStatus("thinking...", queuedInputs()))
    setNotices([])

    const activeSessionId = sessionId()
    markSessionActive(activeSessionId)
    let completedResponse = false

    let noticesCleared = false
    const clearNoticesOnce = () => {
      if (!noticesCleared) {
        noticesCleared = true
      }
    }

    try {
      const next = await runSession(input, sanitizeMessages(messages()), {
        abort: runAbort.signal,
        origin: peerOrigin ? { peer: peerOrigin } : undefined,
        streamReasoningChunk: (text) => { clearNoticesOnce(); streamState.streamReasoningChunk(text) },
        streamAssistantChunk: (text) => { clearNoticesOnce(); streamState.streamAssistantChunk(text) },
        streamToolCallChunk: (index, input) => { clearNoticesOnce(); streamState.streamToolCallChunk(index, input) },
        setStreamingToolResult: (input) => streamState.setToolResult(input),
        addMessage: (msg) => {
          if (msg.role === "assistant") streamState.reset()
          if (msg.role === "tool") streamState.reset()
          setMessages((prev) => [...prev, msg])
        },
        notify: (text, kind, code) => {
          setNotices((prev) => [...prev, { kind: kind as DisplayBlock["kind"], text }])
          // Surface step-limit notices as toasts so they can't be missed.
          if (code === "step_limit_reached") {
            showToast("warning", "Step limit reached", text, 8000)
          }
        },
        setStatus: (text) => setStatus(formatQueueStatus(text, queuedInputs())),
        scrollBottom,
        model: currentModel,
        modelInfo: currentModelInfo,
        mode: mode(),
        provider: currentProvider,
        keyName: getActiveConfiguredProviderKeyName(currentProvider) ?? "anonymous",
        reasoning_effort: reasoningEffort(),
        maxSteps: maxSteps(),
        disabledToolGroups: disabledToolGroups(),
        onUsage: (inputTokens, outputTokens, cachedInputTokens) => {
          appendUsageEntry({
            timestamp: Date.now(),
            provider: currentProvider,
            keyName: getActiveConfiguredProviderKeyName(currentProvider) ?? "anonymous",
            model: currentModel,
            inputTokens,
            outputTokens,
            cachedInputTokens,
            sessionId: sessionId(),
          })
        },
      }, {
        runSync,
        systemPrompt: peerOrigin
          ? (mode: RunMode) => systemPrompt(mode) + peerRequestSystemPrompt(peerOrigin, oneWay)
          : systemPrompt,
        parseJson: tryParseJSON,
        compactionSummary: compaction()?.summary,
        ask: (req) => new Promise<void>((resolve, reject) => {
          if (shouldAutoApprove(req, permissionRules())) { resolve(); return }
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
      setStatus(formatQueueStatus(autopilotEnabled() ? "autopilot enabled" : "waiting for input", queuedInputs()))
      queueMicrotask(scrollBottom)
      completedResponse = true
    } catch (err) {
      const isAbort = err instanceof Error && (err.name === "AbortError" || err.message === "aborted")
      if (!isAbort) {
        const msg = err instanceof Error ? err.message : String(err)
        setNotices((prev) => [...prev, { kind: "error", text: `Error: ${msg}` }])
        setStatus(formatQueueStatus("error", queuedInputs()))
      } else {
        setStatus(formatQueueStatus("interrupted", queuedInputs()))
      }
    } finally {
      unmarkSessionActive(activeSessionId)
      runAbort = undefined
      setRunning(false)
    }
    if (completedResponse && !abortSignal.aborted) {
      await maybeAutoCompactContext("")
    }
  }

  const submit = async () => {
    if (autocompleteApi?.visible()) {
      autocompleteApi.select()
      return
    }
    const rawInput = draft().trim()
    if (!rawInput) return
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

    if (input.toLowerCase() === "exit" || input.toLowerCase() === "quit") {
      void exitApp(0)
      return
    }

    if (pendingCodexBrowserAuth && isOAuthCallbackUrl(input)) {
      try {
        await pendingCodexBrowserAuth.complete(input)
        pendingCodexBrowserAuth = undefined
        await completeCodexAuthAndSwitch()
      } catch (error) {
        setStatus("Codex authorization failed")
        setNotices((prev) => [...prev, { kind: "error", text: error instanceof Error ? error.message : String(error) }])
      }
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
          const nextModel = models.some((entry) => entry.id === currentModel)
            ? currentModel
            : models[0]?.id ?? fallbackModel
          if (!nextModel) return { ok: false, message: `No models available for provider: ${id}` }
          const nextModelInfo = providerModels()[id]?.find((entry) => entry.id === nextModel)
          if (!applyProviderModel(id, nextModel, true, nextModelInfo)) return { ok: false, message: `Failed to switch provider: ${id}` }
          return { ok: true, message: `Provider switched to ${id} (${nextModel})` }
        },
        currentModel,
        setCurrentModel: async (name) => {
          const slash = name.indexOf("/")
          const providerId = slash > 0 ? name.slice(0, slash) : currentProvider
          const modelId = slash > 0 ? name.slice(slash + 1) : name
          const provider = PROVIDERS[providerId]
          if (!provider) return { ok: false, message: `Unknown provider: ${providerId}` }
          const models = await ensureModelsForProvider(providerId)
          if (models.length > 0 && !models.some((entry) => entry.id === modelId)) {
            return { ok: false, message: `Model not found for ${providerId}: ${modelId}` }
          }
          const nextModelInfo = providerModels()[providerId]?.find((entry) => entry.id === modelId)
          if (!applyProviderModel(providerId, modelId, true, nextModelInfo)) return { ok: false, message: `Failed to switch model: ${providerId}/${modelId}` }
          return { ok: true, message: `Model switched to ${providerId}/${modelId}` }
        },
        mode: mode(),
        setMode,
        reasoningEffort: reasoningEffort(),
        setReasoningEffort,
        messages,
        setMessages,
        setDraft: setComposerText,
        setNotices,
        showToast,
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
          setSessionScope("cwd")
        },
        openQueuedMessages: openQueuedMessagesPalette,
        openHelp: () => {
          setShowPalette(true)
          setReferenceTitle("Help")
          setReferenceContent(HELP_CONTENT)
          setReferenceSkills(undefined)
          setPaletteMode("reference")
          setPaletteIndex(0)
        },
        openSkills: (skills) => {
          setShowPalette(true)
          setReferenceTitle("Skills")
          setReferenceSkills(skills)
          setPaletteMode("reference")
          setPaletteIndex(0)
        },
        openSkill: (name, content) => {
          setShowPalette(true)
          setReferenceTitle(`Skill: ${name}`)
          setReferenceContent(content)
          setReferenceSkills(undefined)
          setPaletteMode("reference")
          setPaletteIndex(0)
        },
        openUsageDashboard: () => {
          setShowUsageDashboard(true)
        },
        compactSession: compactCurrentSession,
        viewCompactionSummary,
        exportCompactSession,
        refreshSessions,
        codexLogin: runCodexLogin,
        xaiLogin: runXaiLogin,
        getAutopilotMode: autopilotMode,
        setAutopilotMode: configureAutopilot,
        peerName: activePeerName,
        listPeers: activePeerName ? listLivePeers : undefined,
        callPeer: activePeerName
          ? async (name: string, prompt: string) => {
            const peer = findPeer(name)
            if (!peer) return { ok: false, error: `No peer named "${name}" is online` }
            const realWorkdir = canonicalWorkdir(process.cwd())
            if (canonicalWorkdir(peer.workdir) === realWorkdir) return { ok: false, error: "Cannot call a peer with the same working directory" }
            try {
              const res = await fetch(`http://127.0.0.1:${peer.port}/prompt`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-peer-token": peer.token,
                },
                body: JSON.stringify({
                  text: prompt,
                  from: activePeerName,
                  hop: 1,
                  samePairRoundtrips: 0,
                }),
              })
              if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { error?: string }
                return { ok: false, error: body.error ?? `HTTP ${res.status}` }
              }
              return { ok: true }
            } catch (err) {
              return { ok: false, error: err instanceof Error ? err.message : String(err) }
            }
          }
          : undefined,
      }
      // Handle display toggles that need local signal access
      const slashCmd = input.slice(1).split(/\s+/)[0]?.toLowerCase()
      if (slashCmd === "tools" || slashCmd === "tool-details") {
        setShowCompletedTools(c => !c)
        const state = showCompletedTools() ? "shown" : "hidden"
        showToast("success", "Tool details updated", `Completed tool details: ${state}`)
        setComposerText("")
        queueMicrotask(scrollBottom)
        return
      }
      if (slashCmd === "thinking") {
        setShowThinkingBlocks(c => !c)
        const state = showThinkingBlocks() ? "visible" : "hidden"
        showToast("success", "Thinking blocks updated", `Thinking blocks: ${state}`)
        setComposerText("")
        queueMicrotask(scrollBottom)
        return
      }
      if (slashCmd === "auto" || slashCmd === "auto-approve") {
        setAutoApprove(c => !c)
        const state = autoApprove() ? "ON" : "OFF"
        showToast("success", "Auto-approve updated", `Auto-approve: ${state}`)
        setComposerText("")
        queueMicrotask(scrollBottom)
        return
      }
      if (slashCmd === "autopilot") {
        setComposerText("")
      }
      if (slashCmd === "commit") {
        setComposerText("Please help generate a commit message and commit the changes")
        queueMicrotask(scrollBottom)
        return
      }
      if (slashCmd === "usage") {
        setShowUsageDashboard(true)
        setComposerText("")
        return
      }
      if (slashCmd === "compact" || slashCmd === "export") {
        setComposerText("")
      }
      await executeCommand(input, ctx)
      if (input !== "/exit" && input !== "/quit") {
        setComposerText("")
        queueMicrotask(scrollBottom)
      }
      return
    }

    const wasDraining = inputQueue?.isDraining() ?? false
    inputQueue?.enqueue(input)
    setComposerText("")
    if (wasDraining || compacting()) {
      // Queue was already processing an earlier item, or compaction is running;
      // this item will run once the queue/compaction is ready.
      setStatus(formatQueueStatus(compacting() ? "queued until compaction finishes" : "queued", queuedInputs()))
    }
    // Otherwise (was not draining): the item starts running immediately,
    // and runQueuedPrompt will set the status to "thinking...".
    queueMicrotask(scrollBottom)
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
      const sessions = splashRecentSessions()
      const EXIT_IDX = sessions.length

      if (event.name === "return" || event.name === "enter") {
        const selIdx = splashSelectedIndex()
        setShowSplash(false)
        renderer.setTerminalTitle("openzerocode")
        if (selIdx === -1 || sessions.length === 0) {
          doCreateNewSession()
        } else if (sessions[selIdx]) {
          doSwitchSession(sessions[selIdx].id)
          enterWorkspace()
        } else if (selIdx === EXIT_IDX) {
          setShowSplash(true)
          void exitApp(0)
        } else {
          doCreateNewSession()
        }
        event.preventDefault()
        return
      }

      if (event.name === "up") {
        setSplashSelectedIndex(i => Math.max(-1, i - 1))
        event.preventDefault()
        return
      }

      if (event.name === "down") {
        setSplashSelectedIndex(i => Math.min(EXIT_IDX, i + 1))
        event.preventDefault()
        return
      }

      if (event.name === "escape") {
        setSplashSelectedIndex(-1)
        event.preventDefault()
        return
      }

      // q / Q = quick exit from splash
      if (event.name === "q" || event.name === "Q") {
        void exitApp(0)
        event.preventDefault()
        return
      }

      event.preventDefault()
      return
    }

    if (diffOverlay() !== null) {
      if (event.name === "escape" || event.name === "q") {
        setDiffOverlay(null)
      }
      event.preventDefault()
      return
    }

    if (showUsageDashboard()) {
      if (event.name === "escape" || event.name === "q") {
        setShowUsageDashboard(false)
      } else if (event.name === "tab" || event.name === "right" || (event.name === "l" && !event.ctrl)) {
        const idx = VIEW_MODES.indexOf(usageDashboardView())
        setUsageDashboardView(VIEW_MODES[(idx + 1) % VIEW_MODES.length]!)
      } else if ((event.name === "tab" && event.shift) || event.name === "left" || (event.name === "h" && !event.ctrl)) {
        const idx = VIEW_MODES.indexOf(usageDashboardView())
        setUsageDashboardView(VIEW_MODES[(idx - 1 + VIEW_MODES.length) % VIEW_MODES.length]!)
      } else if (event.name === "1") {
        setUsageDashboardView("sessions")
      } else if (event.name === "2") {
        setUsageDashboardView("global")
      } else if (event.name === "3") {
        setUsageDashboardView("daily")
      } else if (event.name === "4") {
        setUsageDashboardView("hourly")
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
      // Text input for palette modes that accept entry/filter text.
      if (paletteMode() !== "queuedMessages") {
        if ((event.ctrl || event.meta) && event.name === "v") {
          void readClipboard().then((text) => {
            if (!text) return
            setPaletteInput((prev) => prev + text.trim())
          })
          event.preventDefault()
          return
        }
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
      if (paletteMode() === "maxSteps") {
        if (event.name === "escape") {
          setPaletteInput("")
          setPaletteMode("actions")
          setPaletteIndex(firstSelectablePaletteIndex(actionPaletteItems()))
          event.preventDefault()
          return
        }
        if (event.name === "return") {
          const value = Number.parseInt(paletteInput().trim(), 10)
          if (!Number.isFinite(value) || value <= 0) {
            setStatus("max steps must be a positive integer")
            event.preventDefault()
            return
          }
          const next = Math.floor(value)
          setMaxSteps(next)
          saveUIPrefs({ maxSteps: next })
          setStatus(`max steps set to ${next}`)
          setPaletteInput("")
          setShowPalette(false)
          setPaletteMode("actions")
          event.preventDefault()
          return
        }
      }
      if (paletteMode() === "localVlmEndpoint") {
        if (event.name === "escape") {
          setPaletteInput("")
          setPaletteMode("experiments")
          setPaletteIndex(0)
          event.preventDefault()
          return
        }
        if (event.name === "return") {
          const value = paletteInput().trim()
          const normalized = value ? normalizeLocalVlmEndpoint(value) : ""
          setLocalVlmEndpoint(normalized)
          setStatus(normalized ? `local VLM endpoint set to ${normalized}` : "local VLM endpoint reset to default")
          setPaletteInput("")
          setPaletteMode("experiments")
          setPaletteIndex(0)
          event.preventDefault()
          return
        }
      }
      if (paletteMode() === "localVlmModel") {
        if (event.name === "escape") {
          setPaletteInput("")
          setPaletteMode("experiments")
          setPaletteIndex(0)
          event.preventDefault()
          return
        }
        if (event.name === "return") {
          const value = paletteInput().trim()
          setLocalVlmModel(value)
          setStatus(value ? `local VLM model set to ${value}` : "local VLM model reset to default")
          setPaletteInput("")
          setPaletteMode("experiments")
          setPaletteIndex(0)
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
      if (paletteMode() === "editProviderBaseURL") {
        if (event.name === "escape") {
          setPaletteInput("")
          setPaletteMode("providerKeys")
          setPaletteIndex(0)
          event.preventDefault()
          return
        }
        if (event.name === "return") {
          const value = paletteInput().trim()
          const target = paletteProviderKeyTarget()
          const result = setConfiguredProviderBaseURL(target, value || undefined)
          setStatus(result.message)
          if (result.ok) {
            setProviderConfigRevision(v => v + 1)
            setProviderModels((prev) => {
              const next = { ...prev }
              delete next[target]
              return next
            })
            setProviderModelsError((prev) => {
              const next = { ...prev }
              delete next[target]
              return next
            })
            if (target === currentProvider) rebuildLayer()
            setPaletteInput("")
            setPaletteMode("providerKeys")
            setPaletteIndex(0)
          }
          event.preventDefault()
          return
        }
      }
      if (paletteMode() === "codexKeyname") {
        if (event.name === "escape") {
          setPaletteInput("")
          setPaletteMode("providerKeys")
          setPaletteIndex(0)
          event.preventDefault()
          return
        }
        if (event.name === "return") {
          const keyname = paletteInput().trim()
          const target = paletteCodexKeynameTarget()
          const ok = setCodexAuthKeyname(target, keyname)
          if (ok) {
            setProviderConfigRevision(v => v + 1)
            setStatus(keyname ? `key name set to "${keyname}"` : "key name cleared")
          } else {
            setStatus("failed to set key name")
          }
          setPaletteInput("")
          setPaletteMode("providerKeys")
          setPaletteIndex(0)
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
      if (paletteMode() === "directories") {
        if (event.name === "escape") {
          setPaletteInput("")
          setPaletteMode("actions")
          setPaletteIndex(firstSelectablePaletteIndex(actionPaletteItems()))
          event.preventDefault()
          return
        }
        if (event.name === "tab") {
          const item = displayItems()[paletteIndex()]
          if (item?.directoryPath) {
            setPaletteInput(displayPath(item.directoryPath) + "/")
            setPaletteIndex(0)
          }
          event.preventDefault()
          return
        }
        if (event.name === "return") {
          const item = displayItems()[paletteIndex()]
          if (isSelectablePaletteItem(item)) item?.onSelect()
          event.preventDefault()
          return
        }
      }
      if (paletteMode() === "sessions" && event.ctrl && event.name === "s") {
        setSessionScope(s => s === "cwd" ? "global" : "cwd")
        setPaletteIndex(0)
        setComposerText("")
        event.preventDefault()
        return
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
          if (paletteProviderKeyTarget() === "openai-codex" && (keyName === "openai" || keyName.startsWith("openai@"))) {
            const ok = deleteCodexAuth(keyName)
            setStatus(ok ? `removed Codex auth "${keyName}"` : `failed to remove Codex auth "${keyName}"`)
            if (ok) setProviderConfigRevision(v => v + 1)
          } else if (paletteProviderKeyTarget() === "xai-oauth" && keyName === "xai-oauth") {
            const ok = deleteXaiAuth()
            setStatus(ok ? "removed xAI OAuth credentials" : "failed to remove xAI OAuth credentials")
            if (ok) setProviderConfigRevision(v => v + 1)
          } else {
            const result = removeConfiguredProviderKey(paletteProviderKeyTarget(), keyName)
            setStatus(result.message)
            if (result.ok) setProviderConfigRevision(v => v + 1)
          }
          setPalettePendingDelete(null)
          event.preventDefault()
          return
        }
        setPalettePendingDelete(keyName)
        setStatus(
          paletteProviderKeyTarget() === "openai-codex" && (keyName === "openai" || keyName.startsWith("openai@"))
            ? `press ctrl+d again to remove Codex auth "${keyName}"`
            : paletteProviderKeyTarget() === "xai-oauth" && keyName === "xai-oauth"
              ? "press ctrl+d again to remove xAI OAuth credentials"
              : `press ctrl+d again to remove key "${keyName}"`
        )
        event.preventDefault()
        return
      }
      if (event.name === "escape") {
        if (paletteMode() === "sessions" || paletteMode() === "providers" || paletteMode() === "directories" || paletteMode() === "autopilot") {
          setPalettePendingDelete(null)
          setPaletteInput("")
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
        } else if (paletteMode() === "queuedMessages") {
          setPalettePendingDelete(null)
          setPaletteMode("actions")
          setPaletteIndex(firstSelectablePaletteIndex(actionPaletteItems()))
        } else if (paletteMode() === "userMessageActions") {
          setUserMsgActionTarget(null)
          setShowPalette(false)
        } else if (paletteMode() === "reference") {
          setShowPalette(false)
          setPaletteMode("actions")
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
      if (compacting()) {
        setStatus("compaction running — please wait")
        showToast("info", "Compaction running", "Compaction cannot be interrupted safely yet.")
        event.preventDefault()
        return
      }
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
        if (autopilotEnabled()) configureAutopilot("off")
        inputQueue?.abort()
        setStatus(formatQueueStatus("interrupted", queuedInputs()))
        event.preventDefault()
        return
      }
    }
    if (event.name === "tab" && autocompleteApi?.visible()) {
      autocompleteApi.select()
      event.preventDefault()
      return
    }
    if (event.name === "tab") {
      const next = cycleCommandArgument(draft(), BUILTIN_COMMANDS, event.shift ? -1 : 1)
      if (next !== undefined) {
        setComposerText(next)
        event.preventDefault()
        return
      }
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

  // Handle terminal bracketed paste events for the palette input
  usePaste((event: PasteEvent) => {
    if (!showPalette()) return
    const text = new TextDecoder().decode(event.bytes)
    if (!text) return
    // Auto-complete Codex OAuth if user pastes a callback URL while palette is open
    if (pendingCodexBrowserAuth && isOAuthCallbackUrl(text)) {
      event.preventDefault()
      void (async () => {
        try {
          await pendingCodexBrowserAuth.complete(text)
          pendingCodexBrowserAuth = undefined
          await completeCodexAuthAndSwitch()
        } catch (error) {
          setStatus("Codex authorization failed")
          setNotices((prev) => [...prev, { kind: "error", text: error instanceof Error ? error.message : String(error) }])
        }
      })()
      return
    }
    setPaletteInput((prev) => prev + text)
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
          sessions={splashSessions()}
          totalSessions={splashSessionsAll().length}
          cwd={currentCwd()}
          layoutMode={layoutMode()}
          model={modelLabel()}
          provider={providerLabel()}
          version={VERSION}
          onSelectSession={(id) => {
            setShowSplash(false)
            renderer.setTerminalTitle("openzerocode")
            doSwitchSession(id)
            enterWorkspace()
          }}
          onNewSession={() => {
            setShowSplash(false)
            renderer.setTerminalTitle("openzerocode")
            doCreateNewSession()
          }}
          onExit={() => void exitApp(0)}
        />
      </Show>

      {/* ── Main work UI (hidden while splash is shown) ── */}
      <Show when={!showSplash()}>
      <ToastViewport items={toasts()} />
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
        backgroundColor={THEME.background}
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
          <box marginTop={1} flexDirection="column" backgroundColor={THEME.background}>
            <Index each={streamingEntries()}>
              {(entry, index) => <ResponseEntry entry={entry()} isFirst={index === 0} />}
            </Index>
          </box>
        </Show>
      </scrollbox>

      <Show when={pendingApproval()}>
        {(approval: () => PendingApproval) => (
          <box flexShrink={0} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} border={["left", "top"]} borderColor="#f85149" backgroundColor={THEME.surface}>
            <text style={{ fg: "#f85149" }}>PERMISSION REQUIRED</text>
            <text style={{ fg: THEME.text }}>{`${approval().request.permission}: ${approval().request.patterns.join("  ")}`}</text>
            <box flexDirection="row" gap={2} marginTop={0}>
              <text
                style={{ fg: THEME.accent }}
                onMouseDown={() => { const a = pendingApproval(); if (a) { setPendingApproval(undefined); a.resolve() } }}
              >{"[y] allow once"}</text>
              <text
                style={{ fg: THEME.muted }}
                onMouseDown={() => { const a = pendingApproval(); if (a) { setPendingApproval(undefined); a.allowAlways() } }}
              >{"[a] always allow"}</text>
              <text
                style={{ fg: "#f85149" }}
                onMouseDown={() => { const a = pendingApproval(); if (a) { setPendingApproval(undefined); a.reject(new Error("denied by user")) } }}
              >{"[n] deny"}</text>
            </box>
          </box>
        )}
      </Show>

      <box flexShrink={0} flexDirection="column" border={["left"]} borderColor={THEME.border}>
        <box backgroundColor={THEME.surface} paddingLeft={2} paddingRight={2} paddingTop={1}>
            <box flexDirection="column">
              <textarea
                placeholder={compacting() ? "Compacting session… please wait" : "Ask anything..."}
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

                  // Auto-complete Codex OAuth if user pastes a callback URL or code
                  if (pendingCodexBrowserAuth && isOAuthCallbackUrl(text)) {
                    event.preventDefault()
                    void (async () => {
                      try {
                        await pendingCodexBrowserAuth.complete(text)
                        pendingCodexBrowserAuth = undefined
                        await completeCodexAuthAndSwitch()
                      } catch (error) {
                        setStatus("Codex authorization failed")
                        setNotices((prev) => [...prev, { kind: "error", text: error instanceof Error ? error.message : String(error) }])
                      }
                    })()
                    return
                  }

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
              <text
                style={{ fg: mode() === "build" ? "#58a6ff" : mode() === "plan" ? "#3fb950" : "#bc8cff" }}
                onMouseDown={() => { const next = mode() === "build" ? "plan" : mode() === "plan" ? "compose" : "build"; setMode(next); setStatus(`Mode: ${next}`) }}
              >
                {mode() === "build" ? "Build" : mode() === "plan" ? "Plan" : "Compose"}
              </text>
              <text style={{ fg: THEME.muted }}>{"  •  "}</text>
              <text style={{ fg: THEME.text }}>{truncateText(modelLabel(), 32)}</text>
              <Show when={autoApprove()}>
                <text style={{ fg: THEME.muted }}>{"  •  "}</text>
                <text style={{ fg: "#3fb950" }}>{"AUTO"}</text>
              </Show>
              <Show when={autopilotEnabled()}>
                <text style={{ fg: THEME.muted }}>{"  •  "}</text>
                <text style={{ fg: "#d29922" }}>{autopilotMode() === "proactive" ? "PILOT+" : "PILOT"}</text>
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
              <Show when={running() || compacting()} fallback={
                <text style={{ fg: THEME.muted }}>{`  •  ${status()}  •  ${queuedInputs() > 0 ? `${queuedInputs()} queued  •  ` : ""}${SCROLL_HINT}`}</text>
              }>
                <box flexDirection="row">
                  <text style={{ fg: THEME.accent }}>{`  ${SPINNER_FRAMES[spinnerFrame()]}  `}</text>
                  <text style={{ fg: THEME.muted }}>{`${status()}  •  `}</text>
                  <Show when={running()} fallback={<text style={{ fg: THEME.muted }}>Please wait</text>}>
                    <text
                      style={{ fg: "#f85149" }}
                      onMouseDown={() => { if (runAbort) runAbort.abort() }}
                    >Esc interrupt</text>
                  </Show>
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
          todos={todos}
          theme={THEME}
          width={sidebarWidth()}
          provider={providerLabel()}
          model={modelLabel()}
          modelInfo={modelInfoLabel()}
          sessionTitle={sessionMeta()?.title}
          cwd={currentCwd()}
          version={VERSION}
          sessionId={sessionId()}
          gitRefreshKey={gitRefreshRevision()}
          geassRevision={geassRevision()}
          onFileClick={(file) => { void handleFileDiffRequest(file) }}
        />
      </Show>

      {/* Vertical mode: sidebar as absolute overlay (collapsible) */}
      <Show when={layoutMode() === "vertical" && !sidebarCollapsed()}>
        <box
          position="absolute"
          right={0}
          top={0}
          height="100%"
          width={overlaySidebarWidth() + 1}
          zIndex={50}
          flexDirection="row"
        >
          <box width={1} backgroundColor={THEME.border} flexShrink={0} />
          <Sidebar
            messages={messages}
            todos={todos}
            theme={THEME}
            width={overlaySidebarWidth()}
            provider={providerLabel()}
            model={modelLabel()}
            modelInfo={modelInfoLabel()}
            sessionTitle={sessionMeta()?.title}
            cwd={currentCwd()}
            version={VERSION}
            sessionId={sessionId()}
            gitRefreshKey={gitRefreshRevision()}
            geassRevision={geassRevision()}
            onFileClick={(file) => { void handleFileDiffRequest(file) }}
          />
        </box>
      </Show>
      </box>

      <SlashAutocomplete
        commands={BUILTIN_COMMANDS}
        draft={draft}
        ref={(api) => { autocompleteApi = api }}
        onCommand={(name) => {
          // Commands that execute immediately with no arguments
          const noArgs = new Set(["help", "clear", "exit", "quit", "commit", "thinking", "tools", "auto", "usage", "learn"])
          if (name === "learn") {
            // Send a learn prompt to the agent
            setComposerText("Analyze this session and extract non-obvious learnings. For each learning, determine if it's project-specific (save to docs/compose/learnings/PROJECT.md) or global (save to ~/.openzerocode/LEARNINGS.md). Follow the compose:learn skill format with Observation, Evidence, and Implication sections.")
            queueMicrotask(() => { void submit() })
          } else if (noArgs.has(name)) {
            setComposerText("/" + name)
            queueMicrotask(() => { void submit() })
          } else {
            // Commands that need an argument — fill the prefix and let user type
            setComposerText("/" + name + " ")
          }
        }}
        onHide={() => {}}
        bottom={8}
        left={3}
        width={dimensions().width - 8}
      />

      <Show when={showPalette() && paletteMode() === "reference"}>
        <box
          position="absolute"
          top={2}
          left={layoutMode() === "horizontal" ? Math.floor((dimensions().width - 2 - activePaletteWidth()) / 2) : 2}
          width={activePaletteWidth()}
          height={dimensions().height - 4}
          zIndex={100}
          backgroundColor={THEME.surface}
          border={["top", "left", "right", "bottom"]}
          borderColor={THEME.accent}
          flexDirection="column"
        >
          <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="row">
            <text style={{ fg: THEME.accent, flexGrow: 1 }}>{referenceTitle()}</text>
            <text
              style={{ fg: THEME.muted }}
              onMouseDown={() => setShowPalette(false)}
            >Esc / tap to close</text>
          </box>
          <scrollbox flexGrow={1} scrollY={true} paddingLeft={2} paddingRight={2} paddingBottom={1}>
            <Show
              when={referenceSkills()}
              fallback={<text style={{ fg: THEME.muted }}>{referenceContent()}</text>}
            >
              {(skills: () => SkillSummary[]) => (
                <Show when={skills().length > 0} fallback={<text style={{ fg: THEME.muted }}>No skills found</text>}>
                  <box flexDirection="column">
                    <For each={skills()}>{(skill) => {
                      const description = skill.description?.replace(/\s+/g, " ").trim()
                      return (
                        <box flexDirection="row" alignItems="center">
                          <box
                            border={["top", "right", "bottom", "left"]}
                            borderColor={THEME.border}
                            paddingLeft={1}
                            paddingRight={1}
                          >
                            <text style={{ fg: THEME.text }}>{skill.name}</text>
                          </box>
                          <Show when={description}><text style={{ fg: THEME.muted }}> — {description}</text></Show>
                        </box>
                      )
                    }}</For>
                  </box>
                </Show>
              )}
            </Show>
          </scrollbox>
        </box>
      </Show>

      <Show when={showPalette() && paletteMode() !== "reference"}>
        <box
          position="absolute"
          top={Math.floor((dimensions().height - (paletteMode() === "rename" || paletteMode() === "maxSteps" || paletteMode() === "localVlmEndpoint" || paletteMode() === "localVlmModel" || paletteMode() === "addProviderKeyName" || paletteMode() === "addProviderKeyValue" || paletteMode() === "codexKeyname" ? 7 : (paletteMode() === "models" ? paletteItems().length : filteredPaletteItems().length) + 6)) / 2)}
          left={layoutMode() === "horizontal"
            ? Math.floor((dimensions().width - 2 - activePaletteWidth()) / 2)
            : 2
          }
          width={activePaletteWidth()}
          zIndex={100}
          backgroundColor={THEME.surface}
          border={["top", "left", "right", "bottom"]}
          borderColor={THEME.accent}
          flexDirection="column"
        >
          <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="row">
            <text style={{ fg: THEME.accent, flexGrow: 1 }}>
              {paletteMode() === "rename"
                ? "Rename Session"
                : paletteMode() === "sessions"
                  ? `Switch Session`
                  : paletteMode() === "directories"
                    ? "Change Directory"
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
                        : paletteMode() === "codexKeyname"
                          ? `Key name · ${paletteCodexKeynameTarget()}`
                        : paletteMode() === "editProviderBaseURL"
                          ? `Base URL · ${paletteProviderKeyTarget()}`
                        : paletteMode() === "localVlmEndpoint"
                          ? "Local VLM Endpoint"
                        : paletteMode() === "localVlmModel"
                          ? "Local VLM Model"
                        : paletteMode() === "timeline"
                          ? "Timeline"
                        : paletteMode() === "queuedMessages"
                          ? "Queued Messages"
                        : paletteMode() === "autopilot"
                          ? "Autopilot"
                          : paletteMode() === "userMessageActions"
                            ? "Message Actions"
                      : "Command Palette"}
            </text>
            <text
              style={{ fg: THEME.muted }}
              onMouseDown={() => setShowPalette(false)}
            >  Esc / ✕</text>
          </box>
          <box border={["top"]} borderColor={THEME.border} flexDirection="column">
            <Show when={paletteMode() !== "queuedMessages" && paletteMode() !== "autopilot"}>
              <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="column" gap={1}>
                  <text style={{ fg: THEME.muted }}>
                    {paletteMode() === "rename" ? "Enter new name:" : paletteMode() === "maxSteps" ? "Max steps:" : paletteMode() === "localVlmEndpoint" ? "Local VLM endpoint:" : paletteMode() === "localVlmModel" ? "Local VLM model:" : paletteMode() === "directories" ? "Directory:" : paletteMode() === "models" ? "Filter models:" : paletteMode() === "addProviderKeyName" ? "Enter key name:" : paletteMode() === "addProviderKeyValue" ? "Enter key value:" : paletteMode() === "codexKeyname" ? "Key name (leave blank to clear):" : paletteMode() === "editProviderBaseURL" ? "Enter base URL (blank = default):" : "Filter:"}
                  </text>
                  <box
                    backgroundColor={THEME.background}
                    border={["left", "right"]}
                    borderColor={THEME.border}
                    paddingLeft={1}
                    paddingRight={1}
                    flexDirection="row"
                  >
                    <text style={{ fg: THEME.text }} wrapMode="none">{paletteInput()}</text>
                    <text style={{ fg: THEME.accent }}>▌</text>
                  </box>
                </box>
            </Show>
            <Show when={paletteMode() !== "rename" && paletteMode() !== "maxSteps" && paletteMode() !== "localVlmEndpoint" && paletteMode() !== "localVlmModel" && paletteMode() !== "addProviderKeyName" && paletteMode() !== "addProviderKeyValue" && paletteMode() !== "codexKeyname"}>
              <For each={paletteMode() === "models" ? paletteItems() : filteredPaletteItems()}>
                {(item, index) => (
                  <box
                    paddingLeft={2}
                    paddingRight={2}
                    paddingTop={0}
                    paddingBottom={0}
                    backgroundColor={item.kind !== "section"
                      ? isPalettePendingDelete(item)
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
                    <text style={{ fg: item.kind === "section" ? THEME.accent : isPalettePendingDelete(item) ? "#ffb3b3" : index() === paletteIndex() ? "#ffffff" : THEME.text }}>
                      {truncateText(item.label, PALETTE_LABEL_MAX())}
                    </text>
                    <Show when={item.hint && item.kind !== "section"}>
                      <text
                        style={{ fg: isPalettePendingDelete(item) ? "#ffb3b3" : index() === paletteIndex() ? THEME.border : THEME.muted }}
                        wrapMode="none"
                      >
                        {truncateText(isPalettePendingDelete(item) ? "Ctrl+D again" : item.hint ?? "", PALETTE_HINT_MAX())}
                      </text>
                    </Show>
                  </box>
                )}
              </For>
            </Show>
          </box>
          <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} border={["top"]} borderColor={THEME.border} flexDirection="column" gap={1}>
            <Show when={paletteMode() === "sessions"}>
              <box flexDirection="row" gap={1}>
                <text
                  style={{ fg: THEME.accent }}
                  onMouseDown={() => { setSessionScope(s => s === "cwd" ? "global" : "cwd"); setPaletteIndex(0); setComposerText("") }}
                >{sessionScope() === "cwd" ? "Scoped" : "Global"}</text>
                <text style={{ fg: THEME.border }}>{"· Ctrl+S"}</text>
              </box>
            </Show>
            <text style={{ fg: THEME.muted }}>
              {paletteMode() === "rename"
                ? "Enter confirm  •  Esc cancel"
                : paletteMode() === "maxSteps" || paletteMode() === "localVlmEndpoint" || paletteMode() === "localVlmModel"
                  ? "Enter save  •  Esc cancel"
                  : paletteMode() === "addProviderKeyName" || paletteMode() === "addProviderKeyValue"
                  ? "Enter confirm  •  Esc back"
                  : paletteMode() === "sessions"
                  ? "Type to filter  •  ↑↓ navigate  •  Enter select  •  Ctrl+D delete  •  Esc back"
                  : paletteMode() === "directories"
                  ? "Type path  •  Tab complete  •  Enter select/change  •  Esc back"
                  : paletteMode() === "models"
                    ? "Type to filter  •  ↑↓ navigate  •  Enter select  •  Esc back"
                    : paletteMode() === "providers"
                      ? "Type to filter  •  ↑↓ navigate  •  Enter select  •  Esc back"
                    : paletteMode() === "providerKeys"
                      ? "↑↓ navigate  •  Enter select  •  Ctrl+D delete  •  Esc back"
                    : paletteMode() === "queuedMessages"
                      ? "↑↓ navigate  •  Enter cancel  •  Esc back"
                    : paletteMode() === "autopilot"
                      ? "↑↓ navigate  •  Enter select  •  Esc back"
                    : paletteMode() === "codexKeyname"
                      ? "Enter key name  •  Enter save  •  Esc back"
                    : "Type to filter  •  ↑↓ navigate  •  Enter select  •  Esc close"}
            </text>
          </box>
        </box>
      </Show>

      {/* ── Usage Dashboard overlay ── */}
      <Show when={showUsageDashboard()}>
        <UsageDashboard
          onClose={() => setShowUsageDashboard(false)}
          viewMode={usageDashboardView()}
          onViewMode={setUsageDashboardView}
          theme={THEME}
          width={dimensions().width}
          height={dimensions().height}
        />
      </Show>

      {/* ── File Diff overlay ── */}
      <Show when={diffOverlay() !== null}>
        {(() => {
          const overlay = diffOverlay()!
          const overlayWidth = Math.min(dimensions().width - 4, 120)
          const overlayLeft = Math.floor((dimensions().width - overlayWidth) / 2)
          return (
            <box
              position="absolute"
              top={2}
              left={overlayLeft}
              width={overlayWidth}
              height={dimensions().height - 4}
              zIndex={110}
              backgroundColor={THEME.surface}
              border={["top", "left", "right", "bottom"]}
              borderColor={THEME.accent}
              flexDirection="column"
            >
              <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} flexDirection="row">
                <text style={{ fg: THEME.accent, flexGrow: 1 }}>{overlay.file}</text>
                <text
                  style={{ fg: THEME.muted }}
                  onMouseDown={() => setDiffOverlay(null)}
                >Esc / tap to close</text>
              </box>
              <scrollbox flexGrow={1} scrollY={true} paddingLeft={1} paddingRight={1} paddingBottom={1} backgroundColor={THEME.surface}>
                <diff
                  diff={overlay.content}
                  view="unified"
                  showLineNumbers={true}
                  syntaxStyle={MARKDOWN_SYNTAX}
                  fg={THEME.text}
                  addedBg={THEME.diffAddedBg}
                  removedBg={THEME.diffRemovedBg}
                  {...DIFF_RENDER_PROPS}
                  addedSignColor="#22c55e"
                  removedSignColor="#ef4444"
                  lineNumberFg="#6b7280"
                />
              </scrollbox>
            </box>
          )
        })()}
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
