import { Effect } from "effect"
import { ToolRegistry } from "../tool/registry"
import { Provider } from "../provider/types"
import type { Message, ToolCall, ModelInfo } from "../provider/types"
import { createAssistantMessage, createToolMessage } from "../provider/message-parts"
import { Context, Result } from "../tool/tool"
import type { PermissionRequest } from "../tool/types"
import { convertToolsToDefs, convertToolResult } from "../core/convert"
import { selectEnabledTools, selectLiteTools, selectPlanModeTools } from "../tool/selection"
import { getHarnessProfile, type HarnessProfile } from "./system-prompt"
import { delay, formatProviderError, isCompactionRetryableError, isRateLimitError, isTransientProviderError } from "./errors"
import { estimateMessageRequestTokens, estimateTokens, getEffectiveContextLimit, getModelConfig, modelSupportsVision } from "../provider/models"
import { analyzeImageWithLocalVlm, getDefaultLocalVlmEndpoint, getDefaultLocalVlmModel } from "../browser/local-vlm-client"
import type { RunOutcome, StreamChunk } from "../server/types"

type AccToolCall = { id?: string; index?: number; name: string; arguments: string }
export type RunMode = "build" | "plan" | "compose"

const PROVIDER_RETRY_LIMIT = 3
const PROVIDER_RETRY_BASE_MS = 1000
const PROVIDER_RETRY_MAX_MS = 8000
// Keep room for the model's response and serialization/tokenizer differences.
// This is deliberately lower than the hard context limit, not a completion cap.
const REQUEST_CONTEXT_TARGET_RATIO = 0.72

function providerRetryDelay(retryNumber: number): number {
  const exponential = Math.min(PROVIDER_RETRY_BASE_MS * (2 ** Math.max(0, retryNumber - 1)), PROVIDER_RETRY_MAX_MS)
  // ±20% jitter prevents several sessions from reconnecting in lockstep.
  return Math.round(exponential * (0.8 + Math.random() * 0.4))
}

function debugProviderRetry(message: string, error?: unknown): void {
  const enabled = ["true", "1", "yes"].includes((process.env.OPENZEROCODE_DEBUG ?? "").toLowerCase())
  if (!enabled) return
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "")
  console.error(`[openzerocode:provider-retry] ${message}${detail ? ` (${detail})` : ""}`)
}

/**
 * Stable fingerprint for a tool failure. Two tool errors with the same
 * fingerprint are treated as the same recurring failure by the
 * replan-needed detector. We hash on `tool name` + a normalised slice of the
 * first line of the error message so wording changes don't reset the count.
 */
export function toolErrorFingerprint(tool: string, output: string): string {
  const firstLine = String(output).split("\n").find((line) => line.trim().length > 0) ?? ""
  const normalized = firstLine
    .replace(/0x[0-9a-fA-F]+/g, "<hex>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
  return `${tool}::${normalized}`
}

/** Stable fingerprint for a provider-level failure message. */
export function providerErrorSignature(message: string): string {
  return message
    .replace(/0x[0-9a-fA-F]+/g, "<hex>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
}

const REPLAN_REPEAT_THRESHOLD = 3

/**
 * Build the outcome chunk for a given RunOutcome. The public streamSession()
 * wrapper dispatches onOutcome while enforcing the one-terminal-outcome rule.
 */
function makeOutcome(outcome: RunOutcome): StreamChunk {
  return { type: "outcome", outcome }
}

/**
 * If any single tool error fingerprint has fired at least
 * REPLAN_REPEAT_THRESHOLD times this run, return a `replan_needed` outcome
 * summarising the recent recurring errors. Otherwise return undefined.
 */
function dominantToolErrorOutcome(
  counts: Map<string, { tool: string; signature: string; count: number }>,
): RunOutcome | undefined {
  let dominant: { tool: string; signature: string; count: number } | undefined
  for (const entry of counts.values()) {
    if (entry.count < REPLAN_REPEAT_THRESHOLD) continue
    if (!dominant || entry.count > dominant.count) dominant = entry
  }
  if (!dominant) return undefined
  // Surface the worst few fingerprints, ordered by count desc, so the
  // follow-up prompt can name them concretely.
  const recent = [...counts.values()]
    .filter((entry) => entry.count >= REPLAN_REPEAT_THRESHOLD)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((entry) => ({ tool: entry.tool, signature: entry.signature }))
  const reason = `${dominant.tool} failed with the same error ${dominant.count} times this run (${dominant.signature})`
  return { kind: "replan_needed", reason, recentErrors: recent }
}

type SessionUi = {
  abort: AbortSignal
  modelInfo?: ModelInfo
  streamReasoningChunk: (text: string) => void
  streamAssistantChunk: (text: string) => void
  streamToolCallChunk: (index: number, input: { id?: string; tool?: string; argumentsChunk?: string }) => void
  setStreamingToolResult: (input: { id?: string; tool?: string; output: string; error?: boolean }) => void
  addMessage: (msg: Message) => void
  notify: (text: string, kind: string, code?: string) => void
  setStatus: (text: string) => void
  scrollBottom: () => void
  model: string
  mode: RunMode
  provider: string
  keyName: string
  reasoning_effort?: "low" | "medium" | "high" | "max"
  onUsage?: (inputTokens: number, outputTokens: number, cachedInputTokens: number) => void
  /**
   * Called for every machine-readable run outcome (step limit, provider error,
   * replan-needed, completed, abort). Equivalent to the `onOutcome` option on
   * StreamOptions; this duplicate exists so TUI-style callers that go through
   * runSession() can react without consuming the generator directly.
   */
  onOutcome?: (outcome: RunOutcome) => void
  maxSteps?: number
  origin?: { peer: string }
  /** Selectable tool groups to hide from the model (denylist; core tools always on). */
  disabledToolGroups?: string[]
  /** Drain user guidance submitted with /steer during this active run. */
  consumeSteeringMessages?: () => string[]
  /** Report whether this run still has a future model boundary for steering. */
  setSteeringAvailable?: (available: boolean) => void
}

type SessionRuntime = {
  runSync: <E, A>(effect: Effect.Effect<A, E, ToolRegistry | Provider>) => Promise<A>
  systemPrompt: (mode: RunMode) => string
  parseJson: (raw: string) => Record<string, unknown>
  compactionSummary?: string
  ask: (request: Omit<PermissionRequest, "id">) => Promise<void>
}

function estimateMessagesTokens(messages: Message[]): number {
  return estimateMessageRequestTokens(messages)
}

function estimateToolDefinitionsTokens(tools: unknown[]): number {
  return tools.length === 0 ? 0 : estimateTokens(JSON.stringify(tools))
}

function longestContinuationOverlap(previous: string, continuation: string): number {
  const max = Math.min(previous.length, continuation.length)
  for (let length = max; length > 0; length--) {
    if (previous.endsWith(continuation.slice(0, length))) return length
  }
  return 0
}

function couldStillBeContinuationOverlap(previous: string, continuation: string): boolean {
  if (!continuation) return true
  for (let length = previous.length; length >= continuation.length; length--) {
    if (previous.slice(previous.length - length).startsWith(continuation)) return true
  }
  return false
}

function trimHistoryForInitialRequest(
  permanentPrefix: Message[],
  history: Message[],
  contextLimit: number,
): Message[] {
  if (history.length === 0) return history

  const targetTotal = Math.floor(contextLimit * REQUEST_CONTEXT_TARGET_RATIO)
  const prefixCost = estimateMessagesTokens(permanentPrefix)
  const historyBudget = Math.max(0, targetTotal - prefixCost)
  let used = 0
  let start = history.length

  for (let i = history.length - 1; i >= 0; i--) {
    const cost = estimateMessagesTokens([history[i]!])
    if (used + cost > historyBudget) break
    used += cost
    start = i
  }

  // Avoid sending orphaned tool results without their assistant tool call.
  while (start < history.length && history[start]?.role === "tool") start++
  return history.slice(start)
}

function compactCurrentTurnForRequest(
  permanentPrefix: Message[],
  currentTurnMessages: Message[],
  contextLimit: number,
): Message[] {
  if (currentTurnMessages.length === 0) return permanentPrefix

  const targetTotal = Math.floor(contextLimit * REQUEST_CONTEXT_TARGET_RATIO)
  const prefixCost = estimateMessagesTokens(permanentPrefix)
  const turnBudget = Math.max(0, targetTotal - prefixCost)
  if (estimateMessagesTokens(currentTurnMessages) <= turnBudget) {
    return [...permanentPrefix, ...currentTurnMessages]
  }

  let used = 0
  let tailStart = currentTurnMessages.length
  for (let i = currentTurnMessages.length - 1; i >= 0; i--) {
    const message = currentTurnMessages[i]!
    const cost = estimateMessagesTokens([message])
    if (used + cost > turnBudget) break
    used += cost
    tailStart = i
  }

  // Avoid sending orphaned tool results without their assistant tool call.
  while (tailStart < currentTurnMessages.length && currentTurnMessages[tailStart]?.role === "tool") {
    tailStart++
  }

  const omitted = currentTurnMessages.slice(0, tailStart)
  const tail = currentTurnMessages.slice(tailStart)
  if (omitted.length === 0) return [...permanentPrefix, ...tail]

  const omittedToolResults = omitted.filter((message) => message.role === "tool").length
  const omittedAssistantMessages = omitted.filter((message) => message.role === "assistant").length
  const summary: Message = {
    role: "system",
    content: [
      "[Current Turn Compacted]",
      `${omitted.length} earlier current-turn messages were omitted to stay within the model context window.`,
      `Omitted: ${omittedAssistantMessages} assistant/tool-call messages and ${omittedToolResults} tool result messages.`,
      "Recent tool activity is preserved below; continue from that latest available state.",
    ].join("\n"),
  }

  return [...permanentPrefix, summary, ...tail]
}

function messageText(message: Message): string {
  if (typeof message.content === "string") return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => part.type === "text" ? part.text : "[image]")
      .join(" ")
  }
  if (message.tool_calls?.length) {
    return message.tool_calls
      .map((call) => `tool call: ${call.function.name ?? "unknown"} ${call.function.arguments ?? ""}`.trim())
      .join("; ")
  }
  return ""
}

function compactLine(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export function createRecentContextAnchor(history: Message[], maxMessages = 8): Message | undefined {
  const recent = history
    .filter((message) => message.role !== "system")
    .slice(-maxMessages)

  const lines = recent.flatMap((message) => {
    if (message.role === "assistant" && message.tool_calls?.length && !message.content) {
      return message.tool_calls.map((call) => `- assistant: requested tool ${call.function.name ?? "unknown"}`)
    }

    const text = messageText(message)
    if (!text) return []
    if (message.role === "tool") {
      const toolName = message.parts?.find((part) => part.type === "tool-result")?.tool
      return [`- tool${toolName ? ` (${toolName})` : ""}: ${compactLine(text, 220)}`]
    }
    return [`- ${message.role}: ${compactLine(text, 240)}`]
  })

  if (lines.length === 0) return undefined

  return {
    role: "system",
    content: [
      "[Recent Context Anchor]",
      "Use this compact anchor to preserve continuity with the immediately preceding conversation. It is not a user request; answer the latest user message below.",
      ...lines,
    ].join("\n"),
  }
}

function recentContextAnchorEnabled(): boolean {
  return !["false", "0", "no", "off"].includes((process.env.OPENZEROCODE_RECENT_CONTEXT_ANCHOR ?? "true").toLowerCase())
}

/**
 * Provider failures used to be persisted as assistant text. They are UI
 * diagnostics rather than model output, and replaying one in the next request
 * can make the model continue or react to the error instead of the user's task.
 * Keep this narrow so a legitimate assistant answer that mentions an error is
 * never removed.
 */
function isLegacyProviderFailureMessage(message: Message): boolean {
  if (message.role !== "assistant" || message.tool_calls || typeof message.content !== "string") return false
  return message.content.startsWith("Error: Provider error:")
    || message.content === "Error: Network error while contacting provider. Please retry."
    || message.content.startsWith("Error: Provider returned an empty assistant response")
    || message.content.startsWith("Error: Provider returned reasoning without an assistant response")
}

function discardLegacyProviderFailures(history: Message[]): Message[] {
  return history.filter((message) => !isLegacyProviderFailureMessage(message))
}

export type StreamOptions = {
  abort: AbortSignal
  model: string
  modelInfo?: ModelInfo
  mode: RunMode
  provider: string
  keyName: string
  /** Reasoning effort for supported models (e.g. DeepSeek V4 Pro, OpenAI o-series). */
  reasoning_effort?: "low" | "medium" | "high" | "max"
  /** Working directory passed to tools as cwd/root. Defaults to process.cwd(). */
  workdir?: string
  /** Max model round-trips per run. Defaults to OPENZEROCODE_MAX_STEPS or 50. */
  maxSteps?: number
  /** When set, the user message is tagged with this peer origin for display. */
  origin?: { peer: string }
  /** Selectable tool groups to hide from the model (denylist; core tools always on). */
  disabledToolGroups?: string[]
  /** Inject a short request-time summary of recent history. Defaults to true. */
  recentContextAnchor?: boolean
  /** Drain user guidance submitted while the current agent run is active. */
  consumeSteeringMessages?: () => string[]
  /** Report whether guidance submitted now can be consumed by this run. */
  setSteeringAvailable?: (available: boolean) => void
  /** Capability profile for this request. Defaults to OPENZEROCODE_HARNESS_PROFILE. */
  harnessProfile?: HarnessProfile
  /**
   * Called for every machine-readable run outcome (step limit, provider error,
   * repeated tool error, clean completion, abort). Use this instead of parsing
   * `notice.text` for any automated continuation / replan / scheduler logic.
   */
  onOutcome?: (outcome: RunOutcome) => void
}

/**
 * Core streaming agent loop as an async generator. Yields StreamChunks for
 * every text token, reasoning chunk, tool call delta, tool result, status
 * update, and the final usage / done / error events.
 *
 * The full message list (including the user message and all assistant/tool
 * messages produced this run) is exposed via the generator's return value.
 */
async function* streamSessionImpl(
  userInput: string,
  history: Message[],
  options: StreamOptions,
  runtime: SessionRuntime,
): AsyncGenerator<StreamChunk, Message[], void> {
  // Also heal sessions saved by versions which persisted provider diagnostics
  // as assistant messages. The cleaned result replaces that stale history when
  // the caller saves the completed run.
  const usableHistory = discardLegacyProviderFailures(history)
  const retry429 = ["true", "1", "yes"].includes((process.env.OPENZEROCODE_RETRY_429 ?? "").toLowerCase())
  // Max model round-trips per run. Each tool-using turn costs one step, so a
  // complex task (many edits/bash calls) can hit this. Configurable via env so
  // long tasks can raise it without a rebuild; default stays conservative to
  // avoid a runaway loop silently burning tokens.
  const maxSteps = (() => {
    if (Number.isFinite(options.maxSteps) && (options.maxSteps ?? 0) > 0) return Math.floor(options.maxSteps!)
    const raw = Number.parseInt(process.env.OPENZEROCODE_MAX_STEPS ?? "", 10)
    return Number.isFinite(raw) && raw > 0 ? raw : 50
  })()
  const CONTINUE_AFTER_LENGTH: Message = {
    role: "system",
    content: "Continue the previous assistant response from exactly where it stopped. Do not restart, do not summarize, and do not answer a different request.",
  }
  const CONTINUE_AFTER_INTERRUPTION: Message = {
    role: "user",
    content: "The provider stream was interrupted. Continue from exactly where the previous assistant message stopped. Do not repeat completed text or tool calls, do not restart, and finish the original task.",
  }
  const providerName = options.provider.toLowerCase()
  const isRecoverableProviderSession = providerName.includes("zero-api")
    || providerName.includes("codex")
    || options.model.toLowerCase().includes("codex")
  let interruptionRecoveries = 0
  let crossedToolBoundary = false
  let continuationOverlapReference: string | undefined
  let accumulatedVisibleText = ""
  const workdir = options.workdir ?? process.cwd()
  // Tracks how many times each tool-error fingerprint has fired this run, so
  // the loop can surface a `replan_needed` outcome once a single failure
  // pattern has been retried past the point of diminishing returns.
  const toolErrorCounts = new Map<string, { tool: string; signature: string; count: number }>()
  // Only pass reasoning_effort to models that support it (e.g. DeepSeek V4 Pro).
  // Sending it to non-reasoning models can cause API errors (OpenAI) or is silently ignored.
  const effectiveReasoningEffort = (() => {
    if (!options.reasoning_effort) return undefined
    const modelCfg = getModelConfig(options.model, options.modelInfo)
    if (!modelCfg.reasoning) {
      // Silently skip: the /reasoning command already warns the user in the UI.
      return undefined
    }
    return options.reasoning_effort
  })()
  const systemMessage: Message = { role: "system", content: runtime.systemPrompt(options.mode) }
  const userMessage: Message = options.origin
    ? { role: "user", content: userInput, origin: options.origin }
    : { role: "user", content: userInput }
  const compactionMessage: Message[] = runtime.compactionSummary
    ? [{ role: "system", content: `[Compaction Summary]\n${runtime.compactionSummary}` }]
    : []
  const resultHistory: Message[] = [...usableHistory, userMessage]
  const turnProgressStart = resultHistory.length
  yield { type: "message", message: userMessage }

  const allTools = await runtime.runSync(Effect.gen(function* () {
    const r = yield* ToolRegistry
    return yield* r.all()
  }))
  // Keep the filtering order stable: profile allowlist → user group settings →
  // run mode. In particular, Lite must not serialize future registry/MCP tool
  // schemas into a small local model's already constrained context window.
  const profileTools = (options.harnessProfile ?? getHarnessProfile()) === "lite"
    ? selectLiteTools(allTools)
    : allTools
  const enabledTools = selectEnabledTools(profileTools, options.disabledToolGroups ?? [])
  const tools = options.mode === "plan" ? selectPlanModeTools(enabledTools) : enabledTools
  const toolDefs = convertToolsToDefs(tools)

  const contextLimit = getEffectiveContextLimit(options.model, options.modelInfo)
  const toolSchemaCost = estimateToolDefinitionsTokens(toolDefs)
  const messageContextLimit = Math.max(1, contextLimit - toolSchemaCost)
  const basePrefix: Message[] = [systemMessage, ...compactionMessage, userMessage]
  const includeRecentContextAnchor = options.recentContextAnchor ?? recentContextAnchorEnabled()
  const buildInitialRequest = (historyLimit: number): { messages: Message[]; permanentPrefix: Message[] } => {
    const retainedHistory = trimHistoryForInitialRequest(basePrefix, usableHistory, historyLimit)
    // An anchor is useful only when budgeting omitted part of the history. Build
    // it from this request's omission, rather than reusing the initial anchor:
    // overflow retries can omit additional messages that otherwise lose the
    // conversational bridge to the retained tail.
    const omittedHistory = usableHistory.slice(0, usableHistory.length - retainedHistory.length)
    const recentContextAnchor = omittedHistory.length > 0 && includeRecentContextAnchor
      ? createRecentContextAnchor(omittedHistory)
      : undefined
    const permanentPrefix: Message[] = [
      systemMessage,
      ...compactionMessage,
      ...(recentContextAnchor ? [recentContextAnchor] : []),
      userMessage,
    ]
    return {
      messages: [...permanentPrefix.slice(0, -1), ...retainedHistory, userMessage],
      permanentPrefix,
    }
  }
  const initialRequest = buildInitialRequest(messageContextLimit)
  const permanentPrefix = initialRequest.permanentPrefix
  const allMessages = initialRequest.messages

  const currentTurnStart = allMessages.length

  // A gateway can accept an overlong request and then close its SSE response
  // without sending either a provider error or a terminal chunk. Retrying that
  // exact transcript only repeats the failure. After an empty interrupted
  // initial response, progressively reduce retained history instead. This is
  // intentionally limited to step zero: later steps must retain tool-call
  // ordering and are compacted by compactCurrentTurnForRequest.
  // Both silent gateway disconnects and explicit upstream context-limit
  // responses are recoverable before the first response byte: resend a smaller
  // history rather than surfacing an error for a request which the user never
  // saw. `contextLimit` is a provider ceiling, while estimates can differ from
  // its tokenizer and wrapper serialization by thousands of tokens.
  let initialContextRecoveries = 0
  const initialRequestWithReducedContext = () => {
    if (initialContextRecoveries === 0) return allMessages
    const reducedLimit = Math.max(1, Math.floor(messageContextLimit / (2 ** initialContextRecoveries)))
    return buildInitialRequest(reducedLimit).messages
  }

  for (let step = 0; step < maxSteps; step++) {
    // Steering is deliberately part of the current agent run, not the normal
    // input queue. Pick it up at model boundaries so it can affect the very
    // next decision without interrupting an in-flight tool side effect.
    if (step > 0) {
      const steering = options.consumeSteeringMessages?.() ?? []
      if (steering.length > 0) {
        const steeringMessage: Message = {
          role: "user",
          content: `[Steering instruction — adjust the current task immediately]\n${steering.join("\n")}`,
        }
        allMessages.push(steeringMessage)
        resultHistory.push(steeringMessage)
        yield { type: "message", message: steeringMessage }
        yield { type: "notice", kind: "system", text: "↪ Steering applied to the active agent run." }
      }
    }
    // Guidance submitted while the final permitted request is in flight cannot
    // be applied by this run. Close admission before that request starts so the
    // TUI cannot acknowledge an instruction which would otherwise be orphaned.
    options.setSteeringAvailable?.(step + 1 < maxSteps)
    yield { type: "status", text: `thinking (step ${step + 1}/${maxSteps})...` }
    let stream: ReadableStream<any> | undefined
    let lastError: unknown

    for (let attempt = 0; attempt <= PROVIDER_RETRY_LIMIT; attempt++) {
      const requestMessages = step === 0
        ? initialRequestWithReducedContext()
        : compactCurrentTurnForRequest(permanentPrefix, allMessages.slice(currentTurnStart), messageContextLimit)

      stream = await runtime.runSync(Effect.gen(function* () {
        const p = yield* Provider
        return yield* p.stream({
          model: options.model,
          messages: requestMessages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          stream: true,
          reasoning_effort: effectiveReasoningEffort,
          // Threading abort into the provider's fetch so the upstream HTTP
          // request is torn down when the user cancels — without this, the
          // read loop below would break out but the network request kept
          // running in the background until the upstream finished.
          signal: options.abort,
        })
      })).catch((error) => {
        lastError = error
        return undefined
      })
      if (stream) break
      // Gateways commonly wrap a provider context error in a 502. Handle this
      // before generic transient retries so we do not submit the same oversized
      // 35k-token payload again. This is safe only before tools/response data.
      const retryContextLimit = step === 0 && isCompactionRetryableError(lastError)
      if (retryContextLimit && !crossedToolBoundary && attempt < PROVIDER_RETRY_LIMIT) {
        initialContextRecoveries++
        debugProviderRetry(`provider rejected context; retrying with reduced history (${initialContextRecoveries}/${PROVIDER_RETRY_LIMIT})`, lastError)
        yield { type: "status", text: "context limit reached, reducing session context..." }
        yield { type: "notice", kind: "system", text: `provider context limit reached; retrying with reduced session context (attempt ${initialContextRecoveries}/${PROVIDER_RETRY_LIMIT})` }
        continue
      }
      const retryRateLimit = retry429 && isRateLimitError(lastError)
      const retryTransient = isRecoverableProviderSession && isTransientProviderError(lastError)
      if (crossedToolBoundary || (!retryRateLimit && !retryTransient) || attempt >= PROVIDER_RETRY_LIMIT) {
        if (crossedToolBoundary && (retryRateLimit || retryTransient)) {
          debugProviderRetry("not replaying request after tool/side-effect boundary", lastError)
        }
        break
      }
      const retryNumber = attempt + 1
      const wait = providerRetryDelay(retryNumber)
      const reason = retryRateLimit ? "rate limited" : "provider connection interrupted"
      debugProviderRetry(`request failed before output; retry ${retryNumber}/${PROVIDER_RETRY_LIMIT} in ${wait}ms`, lastError)
      yield { type: "status", text: `${reason}, retry in ${Math.round(wait / 1000)}s...` }
      yield { type: "notice", kind: "system", text: `${reason}, retrying (${retryNumber}/${PROVIDER_RETRY_LIMIT}) in ${Math.round(wait / 1000)}s` }
      await delay(wait)
    }

    if (!stream) {
      const errorText = formatProviderError(lastError)
      const signature = providerErrorSignature(errorText)
      // A request can fail before a stream exists, so it never reaches the
      // reader-error path below. Emit the same structured terminal outcome
      // before the legacy display/error chunks for all provider failures.
      yield makeOutcome({ kind: "provider_error", message: errorText, signature })
      yield { type: "notice", kind: "error", text: errorText }
      yield { type: "error", message: errorText }
      return resultHistory
    }

    let content = ""
    let pendingContinuationText = ""
    let reasoning = ""
    let hasReasoning = false
    let finishReason: string | null | undefined
    let lastUsageInput = 0
    let lastUsageOutput = 0
    let lastUsageCachedInput = 0
    const acc = new Map<number, AccToolCall>()
    let streamError: unknown
    const reader = stream.getReader()
    // If the user aborts while we're blocked inside reader.read() waiting for
    // the next chunk, the check at the top of the loop wouldn't fire — wire
    // the abort directly into reader.cancel() so the read unblocks immediately
    // and the underlying ReadableStream tears down the source fetch.
    const abortHandler = () => { reader.cancel().catch(() => {}) }
    options.abort.addEventListener("abort", abortHandler, { once: true })
    try {
    while (true) {
      if (options.abort.aborted) break
      let done: boolean
      let value: any
      try {
        const result = await reader.read()
        done = result.done ?? false
        value = result.value
      } catch (error) {
        // Reader cancellation is expected during user aborts. Any other
        // mid-stream failure must be surfaced; treating it as a normal EOF can
        // silently stop an agent turn after a tool result with no final answer.
        if (options.abort.aborted) break
        streamError = error
        break
      }
      if (done) break
      if (value.finish_reason) finishReason = value.finish_reason
      if (value.usage) {
        lastUsageInput = value.usage.prompt_tokens
        lastUsageOutput = value.usage.completion_tokens
        lastUsageCachedInput = value.usage.cached_tokens ?? 0
      }
      if (value.delta.content) {
        let visibleDelta = value.delta.content as string
        if (continuationOverlapReference !== undefined) {
          pendingContinuationText += visibleDelta
          if (couldStillBeContinuationOverlap(continuationOverlapReference, pendingContinuationText)) {
            visibleDelta = ""
          } else {
            const overlap = longestContinuationOverlap(continuationOverlapReference, pendingContinuationText)
            visibleDelta = pendingContinuationText.slice(overlap)
            pendingContinuationText = ""
            continuationOverlapReference = undefined
          }
        }
        if (visibleDelta) {
          content += visibleDelta
          accumulatedVisibleText += visibleDelta
          yield { type: "text", content: visibleDelta }
          yield { type: "status", text: "generating..." }
        }
      }
      if (value.delta.reasoning_content !== undefined) {
        hasReasoning = true
        if (value.delta.reasoning_content) {
          reasoning += value.delta.reasoning_content
          yield { type: "reasoning", content: value.delta.reasoning_content }
          yield { type: "status", text: "reasoning..." }
        }
      }
      for (const tc of value.tool_calls ?? []) {
        // From the first tool-call delta onward, replaying or continuing this
        // user turn could cause the model to issue a side effect twice.
        crossedToolBoundary = true
        const next = acc.get(tc.index ?? 0) ?? { name: "", arguments: "" }
        if (tc.id) next.id = tc.id
        if (tc.function?.name) next.name = tc.function.name
        if (tc.function?.arguments) next.arguments += tc.function.arguments
        if (tc.index !== undefined) next.index = tc.index
        acc.set(tc.index ?? 0, next)
        yield {
          type: "tool_call_delta",
          index: tc.index ?? 0,
          id: tc.id,
          tool: tc.function?.name,
          argumentsChunk: tc.function?.arguments,
        }
        yield { type: "status", text: tc.function?.name ? `preparing tool: ${tc.function.name}` : "preparing tool..." }
      }
    }
    } finally {
      options.abort.removeEventListener("abort", abortHandler)
      // Best-effort: if we exited the loop without aborting (e.g. normal done),
      // releaseLock() lets the stream be GC'd. If we aborted, the cancel above
      // already tore it down.
      try { reader.releaseLock() } catch {}
    }

    if (!streamError && pendingContinuationText && continuationOverlapReference !== undefined) {
      const overlap = longestContinuationOverlap(continuationOverlapReference, pendingContinuationText)
      const visibleDelta = pendingContinuationText.slice(overlap)
      continuationOverlapReference = undefined
      pendingContinuationText = ""
      if (visibleDelta) {
        content += visibleDelta
        accumulatedVisibleText += visibleDelta
        yield { type: "text", content: visibleDelta }
        yield { type: "status", text: "generating..." }
      }
    }

    if (!options.abort.aborted && (lastUsageInput > 0 || lastUsageOutput > 0)) {
      yield { type: "usage", inputTokens: lastUsageInput, outputTokens: lastUsageOutput, cachedInputTokens: lastUsageCachedInput }
    }

    if (options.abort.aborted) {
      yield makeOutcome({ kind: "aborted" })
      return resultHistory
    }

    // Codex/Responses streams can occasionally end without a terminal event.
    // Treat that as an interruption rather than accepting a truncated answer.
    if (!streamError && isRecoverableProviderSession && finishReason == null) {
      streamError = new Error("provider stream ended before completion")
    }

    if (streamError) {
      const canRecover = isRecoverableProviderSession
        && isTransientProviderError(streamError)
        && !crossedToolBoundary
        && interruptionRecoveries < PROVIDER_RETRY_LIMIT
        // Hidden reasoning without visible text is neither transparent nor a
        // safe textual continuation context, so surface that interruption.
        && (content.length > 0 || !hasReasoning)
      if (!canRecover) {
        // Surface a machine-readable provider_error outcome before throwing,
        // so consumers (autopilot, scheduler) can react even though the
        // generator then unwinds via the runSession() catch block.
        const providerMessage = streamError instanceof Error ? streamError.message : String(streamError)
        const signature = providerErrorSignature(providerMessage)
        yield makeOutcome({ kind: "provider_error", message: providerMessage, signature })
        throw streamError
      }

      interruptionRecoveries++
      if (!content) initialContextRecoveries++
      const wait = providerRetryDelay(interruptionRecoveries)
      debugProviderRetry(`stream interrupted; recovery ${interruptionRecoveries}/${PROVIDER_RETRY_LIMIT} in ${wait}ms`, streamError)
      if (content) {
        const partialMessage = createAssistantMessage({
          content,
          reasoning_content: hasReasoning ? (reasoning || undefined) : undefined,
        })
        resultHistory.push(partialMessage)
        allMessages.push(partialMessage, CONTINUE_AFTER_INTERRUPTION)
        // A bounded suffix is enough to remove a replayed opening without
        // making overlap checks quadratic in the full response size.
        continuationOverlapReference = accumulatedVisibleText.slice(-8192)
        yield { type: "message", message: partialMessage }
        yield { type: "notice", kind: "system", text: `provider stream interrupted; saved partial response and continuing (attempt ${interruptionRecoveries}/${PROVIDER_RETRY_LIMIT})` }
      } else {
        // Nothing reached the UI, so safely repeat the same logical step rather
        // than consuming an agent step or adding a synthetic history message.
        // The next initial request also trims more transcript context, because
        // an empty unterminated stream is a common gateway symptom of a request
        // that its effective context window cannot process.
        step--
        yield { type: "notice", kind: "system", text: `provider stream interrupted before output; retrying with reduced session context (attempt ${interruptionRecoveries}/${PROVIDER_RETRY_LIMIT})` }
      }
      yield { type: "status", text: `reconnecting in ${Math.round(wait / 1000)}s...` }
      await delay(wait)
      continue
    }

    const toolCalls: ToolCall[] | undefined = acc.size > 0
      ? [...acc.values()].map((a) => ({
          id: a.id ?? `call_${a.index ?? 0}`,
          type: "function" as const,
          function: { name: a.name, arguments: a.arguments },
        }))
      : undefined

    // Reasoning is intermediate work, not a complete answer. A provider can
    // terminate after emitting it without any visible content or tool call;
    // surface that invalid completion rather than silently ending the turn.
    if (!content && hasReasoning && !toolCalls) {
      const errorText = "Provider returned reasoning without an assistant response"
      const signature = providerErrorSignature(errorText)
      yield makeOutcome({ kind: "provider_error", message: errorText, signature })
      yield { type: "notice", kind: "error", text: errorText }
      yield { type: "error", message: errorText }
      return resultHistory
    }

    if (!content && !hasReasoning && !toolCalls) {
      const hadProgressThisTurn = resultHistory.length > turnProgressStart
      if (hadProgressThisTurn && finishReason !== "length") {
        const replan = dominantToolErrorOutcome(toolErrorCounts)
        yield makeOutcome(replan ?? { kind: "completed" })
        yield { type: "done" }
        return resultHistory
      }
      const errorText = "Provider returned an empty assistant response"
      const signature = providerErrorSignature(errorText)
      yield makeOutcome({ kind: "provider_error", message: errorText, signature })
      yield { type: "notice", kind: "error", text: errorText }
      yield { type: "error", message: errorText }
      return resultHistory
    }

    const assistantMessage: Message = createAssistantMessage({
      content: content || undefined,
      reasoning_content: hasReasoning ? (reasoning || undefined) : undefined,
      tool_calls: toolCalls,
    })
    resultHistory.push(assistantMessage)
    yield { type: "message", message: assistantMessage }

    if (!toolCalls) {
      if (finishReason === "length") {
        allMessages.push(createAssistantMessage({ content: "" }))
        allMessages.push(CONTINUE_AFTER_LENGTH)
        yield { type: "notice", kind: "system", text: "response hit token limit, continuing..." }
        yield { type: "status", text: "continuing response..." }
        continue
      }
      allMessages.push(assistantMessage)
      const steering = step + 1 < maxSteps
        ? (options.consumeSteeringMessages?.() ?? [])
        : []
      if (steering.length > 0) {
        const steeringMessage: Message = {
          role: "user",
          content: `[Steering instruction — adjust the current task immediately]\n${steering.join("\n")}`,
        }
        allMessages.push(steeringMessage)
        resultHistory.push(steeringMessage)
        yield { type: "message", message: steeringMessage }
        yield { type: "notice", kind: "system", text: "↪ Steering applied to the active agent run." }
        yield { type: "status", text: "applying steering..." }
        continue
      }
      const replan = dominantToolErrorOutcome(toolErrorCounts)
      yield makeOutcome(replan ?? { kind: "completed" })
      yield { type: "done" }
      return resultHistory
    }

    allMessages.push(assistantMessage)

    if (options.abort.aborted) {
      yield makeOutcome({ kind: "aborted" })
      return resultHistory
    }

    // Only parallelize tools that are read-only and independent. Mutating tools
    // (write/edit/bash/todowrite/browser/call_peer/etc.) must preserve model order.
    const parallelToolIds = new Set(["read", "grep", "glob", "web_fetch"])
    const canRunInParallel = (call: ToolCall): boolean => parallelToolIds.has(call.function.name ?? "unknown")

    // Serialize permission prompts so the UI only shows one at a time, while
    // allowing approved read-only tool work in the current batch to run in parallel.
    let askTail = Promise.resolve()
    const serializedAsk = (req: Omit<PermissionRequest, "id">): Promise<void> => {
      const next = askTail.then(() => runtime.ask(req))
      askTail = next.catch(() => {})
      return next
    }

    const runTool = (call: ToolCall) => {
      const name = call.function.name ?? "unknown"
      const def = tools.find((tool) => tool.id === name)
      if (!def) {
        return Promise.resolve({ call, name, result: null as null })
      }
      return Effect.runPromise(
        def.execute(runtime.parseJson(call.function.arguments ?? "{}"), new Context({
          abort: options.abort,
          cwd: workdir,
          root: workdir,
          model: options.model,
          ask: (req) => Effect.tryPromise({
            try: () => serializedAsk(req),
            catch: (e) => new Error(String(e)),
          }) as Effect.Effect<void>,
          metadata: () => Effect.void,
        })).pipe(
          // Safety net: if a tool hangs (runaway command, network stall, etc.)
          // we time out after 5 minutes rather than locking the session forever.
          Effect.timeout(300_000),
          Effect.catchCause((cause) => Effect.succeed(new Result({ title: "Error", output: `Tool error: ${cause}` }))),
        ),
      ).then((result) => ({ call, name, result }))
    }

    const emitToolStart = function* (call: ToolCall) {
      const name = call.function.name ?? "unknown"
      const def = tools.find((tool) => tool.id === name)
      if (def) {
        yield { type: "status" as const, text: `running tool: ${name}` }
        yield { type: "tool_start" as const, id: call.id, name, input: call.function.arguments ?? "" }
      }
    }

    for (let i = 0; i < toolCalls.length;) {
      if (options.abort.aborted) {
        yield makeOutcome({ kind: "aborted" })
        return resultHistory
      }
      const call = toolCalls[i]!
      const batch = canRunInParallel(call)
        ? toolCalls.slice(i).findIndex((candidate) => !canRunInParallel(candidate))
        : 1
      const batchSize = batch === -1 ? toolCalls.length - i : batch
      const currentCalls = toolCalls.slice(i, i + batchSize)

      for (const currentCall of currentCalls) {
        if (options.abort.aborted) {
          yield makeOutcome({ kind: "aborted" })
          return resultHistory
        }
        yield* emitToolStart(currentCall)
      }

      const execResults = canRunInParallel(call)
        ? await Promise.all(currentCalls.map(runTool))
        : [await runTool(call)]

      for (const { call: finishedCall, name, result } of execResults) {
        if (options.abort.aborted) {
          yield makeOutcome({ kind: "aborted" })
          return resultHistory
        }
        if (result === null) {
          const errorMsg = createToolMessage({ tool_call_id: finishedCall.id, tool: name, output: `Unknown tool: ${name}`, error: true })
          allMessages.push(errorMsg)
          resultHistory.push(errorMsg)
          const unknownSig = toolErrorFingerprint(name, `Unknown tool: ${name}`)
          toolErrorCounts.set(unknownSig, {
            tool: name,
            signature: unknownSig,
            count: (toolErrorCounts.get(unknownSig)?.count ?? 0) + 1,
          })
          yield { type: "tool_result", id: finishedCall.id, name, output: `Unknown tool: ${name}`, error: true }
          yield { type: "message", message: errorMsg }
          const replan = dominantToolErrorOutcome(toolErrorCounts)
          if (replan) {
            yield makeOutcome(replan)
            yield { type: "done" }
            return resultHistory
          }
          continue
        }
        let toolContent = convertToolResult(result)
        const isError = result.title === "Error"
        if (isError) {
          const sig = toolErrorFingerprint(name, toolContent.text)
          toolErrorCounts.set(sig, {
            tool: name,
            signature: sig,
            count: (toolErrorCounts.get(sig)?.count ?? 0) + 1,
          })
        }

        // Vision fallback: when the model doesn't support images, use local VLM
        // to analyze images and strip them from the content sent to the API.
        if (result.images && result.images.length > 0 && !modelSupportsVision(options.model)) {
          const vlmTexts: string[] = []
          for (const img of result.images) {
            try {
              const analysis = await Effect.runPromise(Effect.promise(() => analyzeImageWithLocalVlm({
                endpoint: getDefaultLocalVlmEndpoint(),
                model: getDefaultLocalVlmModel(),
                prompt: "Describe this image in detail for a coding assistant. Focus on UI elements, layout, text, and visual state.",
                imageBase64: img.base64,
                imageFormat: img.mimeType === "image/jpeg" ? "jpeg" : "png",
              })))
              vlmTexts.push(analysis.text)
            } catch {
              vlmTexts.push("[Image analysis unavailable — local VLM not reachable]")
            }
          }
          if (vlmTexts.length > 0) {
            const vlmSuffix = "\n\n=== Visual Analysis (local VLM) ===\n" + vlmTexts.join("\n\n")
            toolContent = { text: toolContent.text + vlmSuffix }
            // contentParts intentionally omitted — model can't process images
          }
        }

        yield { type: "tool_result", id: finishedCall.id, name, output: toolContent.text, error: isError }
        const toolMsg = createToolMessage({ tool_call_id: finishedCall.id, tool: name, output: toolContent.text, contentParts: toolContent.contentParts })
        allMessages.push(toolMsg)
        resultHistory.push(toolMsg)
        yield { type: "message", message: toolMsg }
        const replan = dominantToolErrorOutcome(toolErrorCounts)
        if (replan) {
          yield makeOutcome(replan)
          yield { type: "done" }
          return resultHistory
        }
      }

      i += batchSize
    }

    if (step + 1 < maxSteps) {
      yield { type: "status", text: `thinking (step ${step + 2}/${maxSteps})...` }
    }
  }

  // Reached the step cap without the model finishing. Surface it so the run
  // isn't mistaken for a clean completion — and tell the user how to allow more.
  yield makeOutcome({ kind: "step_limit_reached", steps: maxSteps, maxSteps })
  yield {
    type: "notice",
    kind: "error",
    code: "step_limit_reached",
    text: `⚠ Stopped after ${maxSteps} steps — the task may be unfinished. Type "continue" to resume, or set OPENZEROCODE_MAX_STEPS higher.`,
  }
  yield { type: "done" }
  return resultHistory
}

/**
 * Public stream wrapper. Every run emits exactly one terminal outcome. It also
 * converts unexpected application failures into `internal_error` without
 * misclassifying them as provider failures; the original error is rethrown
 * after consumers have received the outcome.
 */
export async function* streamSession(
  userInput: string,
  history: Message[],
  options: StreamOptions,
  runtime: SessionRuntime,
): AsyncGenerator<StreamChunk, Message[], void> {
  const gen = streamSessionImpl(userInput, history, options, runtime)
  let terminalOutcome: RunOutcome | undefined
  try {
    while (true) {
      const next = await gen.next()
      if (next.done) return next.value
      const chunk = next.value
      if (chunk.type === "outcome") {
        if (terminalOutcome) continue
        terminalOutcome = chunk.outcome
        options.onOutcome?.(chunk.outcome)
      }
      yield chunk
    }
  } catch (error) {
    if (!terminalOutcome) {
      const outcome: RunOutcome = options.abort.aborted
        ? { kind: "aborted" }
        : { kind: "internal_error", message: error instanceof Error ? error.message : String(error) }
      terminalOutcome = outcome
      options.onOutcome?.(outcome)
      yield { type: "outcome", outcome }
    }
    throw error
  } finally {
    await gen.return(history).catch(() => undefined)
  }
}

/**
 * TUI-facing wrapper. Consumes streamSession() and translates each chunk into
 * the existing SessionUi callbacks so the TUI render path is unchanged.
 */
export async function runSession(
  userInput: string,
  history: Message[],
  ui: SessionUi,
  runtime: SessionRuntime,
): Promise<Message[]> {
  const gen = streamSession(userInput, history, {
    abort: ui.abort,
    model: ui.model,
    modelInfo: ui.modelInfo,
    mode: ui.mode,
    provider: ui.provider,
    keyName: ui.keyName,
    reasoning_effort: ui.reasoning_effort,
    maxSteps: ui.maxSteps,
    origin: ui.origin,
    disabledToolGroups: ui.disabledToolGroups,
    consumeSteeringMessages: ui.consumeSteeringMessages,
    setSteeringAvailable: ui.setSteeringAvailable,
    recentContextAnchor: recentContextAnchorEnabled(),
    harnessProfile: getHarnessProfile(),
    onOutcome: ui.onOutcome,
  }, runtime)
  const resultHistory: Message[] = discardLegacyProviderFailures(history)

  try {
    while (true) {
      const { value, done } = await gen.next()
      if (done) {
        ui.setStatus("waiting for input")
        return value
      }

      const chunk = value
      switch (chunk.type) {
        case "text":
          ui.streamAssistantChunk(chunk.content)
          break
        case "reasoning":
          ui.streamReasoningChunk(chunk.content)
          break
        case "tool_call_delta":
          ui.streamToolCallChunk(chunk.index, { id: chunk.id, tool: chunk.tool, argumentsChunk: chunk.argumentsChunk })
          ui.scrollBottom()
          break
        case "tool_start":
          ui.setStreamingToolResult({ id: chunk.id, tool: chunk.name, output: "running..." })
          ui.scrollBottom()
          break
        case "tool_result":
          ui.setStreamingToolResult({ id: chunk.id, tool: chunk.name, output: chunk.output, error: chunk.error })
          ui.scrollBottom()
          break
        case "status":
          ui.setStatus(chunk.text)
          break
        case "notice":
          ui.notify(chunk.text, chunk.kind, chunk.code)
          break
        case "outcome":
          // Callback already fired inside the generator via makeOutcome; this
          // case exists so the chunk isn't silently dropped from the stream.
          break
        case "usage":
          ui.onUsage?.(chunk.inputTokens, chunk.outputTokens, chunk.cachedInputTokens)
          break
        case "message":
          resultHistory.push(chunk.message)
          ui.addMessage(chunk.message)
          break
        case "error":
          ui.setStatus("error")
          break
        case "done":
          break
      }
    }
  } catch (error) {
    if (ui.abort.aborted) throw error
    const errorText = formatProviderError(error)
    ui.notify(errorText, "error")
    ui.setStatus("error")
    return resultHistory
  }
}
