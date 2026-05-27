import { Effect } from "effect"
import { ToolRegistry } from "../tool/registry"
import { Provider } from "../provider/types"
import type { Message, ToolCall, ModelInfo } from "../provider/types"
import { createAssistantMessage, createToolMessage } from "../provider/message-parts"
import { Context, Result } from "../tool/tool"
import type { PermissionRequest } from "../tool/types"
import { convertToolsToDefs, convertToolResult } from "../core/convert"
import { delay, formatProviderError, isRateLimitError } from "./errors"
import { estimateTokens, getModelConfig } from "../provider/models"
import type { StreamChunk } from "../server/types"

type AccToolCall = { id?: string; index?: number; name: string; arguments: string }
export type RunMode = "build" | "plan"

type SessionUi = {
  abort: AbortSignal
  modelInfo?: ModelInfo
  streamReasoningChunk: (text: string) => void
  streamAssistantChunk: (text: string) => void
  streamToolCallChunk: (index: number, input: { id?: string; tool?: string; argumentsChunk?: string }) => void
  setStreamingToolResult: (input: { id?: string; tool?: string; output: string; error?: boolean }) => void
  addMessage: (msg: Message) => void
  notify: (text: string, kind: string) => void
  setStatus: (text: string) => void
  scrollBottom: () => void
  model: string
  mode: RunMode
  provider: string
  keyName: string
  reasoning_effort?: "low" | "medium" | "high" | "max"
  onUsage?: (inputTokens: number, outputTokens: number, cachedInputTokens: number) => void
}

type SessionRuntime = {
  runSync: <E, A>(effect: Effect.Effect<A, E, ToolRegistry | Provider>) => Promise<A>
  systemPrompt: (mode: RunMode) => string
  parseJson: (raw: string) => Record<string, unknown>
  compactionSummary?: string
  ask: (request: Omit<PermissionRequest, "id">) => Promise<void>
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
}

/**
 * Core streaming agent loop as an async generator. Yields StreamChunks for
 * every text token, reasoning chunk, tool call delta, tool result, status
 * update, and the final usage / done / error events.
 *
 * The full message list (including the user message and all assistant/tool
 * messages produced this run) is exposed via the generator's return value.
 */
export async function* streamSession(
  userInput: string,
  history: Message[],
  options: StreamOptions,
  runtime: SessionRuntime,
): AsyncGenerator<StreamChunk, Message[], void> {
  const retry429 = ["true", "1", "yes"].includes((process.env.OPENZEROCODE_RETRY_429 ?? "").toLowerCase())
  const retrySchedule = [2000, 5000, 10000]
  const CONTINUE_AFTER_LENGTH: Message = {
    role: "system",
    content: "Continue the previous assistant response from exactly where it stopped. Do not restart, do not summarize, and do not answer a different request.",
  }
  const workdir = options.workdir ?? process.cwd()
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
  const userMessage: Message = { role: "user", content: userInput }
  const compactionMessage: Message[] = runtime.compactionSummary
    ? [{ role: "system", content: `[Compaction Summary]\n${runtime.compactionSummary}` }]
    : []

  const sendHistory = (() => {
    if (history.length === 0) return history
    const { contextLimit } = getModelConfig(options.model, options.modelInfo)
    const budget = Math.floor(contextLimit * 0.55)
    let used = 0
    let start = history.length
    for (let i = history.length - 1; i >= 0; i--) {
      const cost = estimateTokens(JSON.stringify(history[i]))
      if (used + cost > budget) break
      used += cost
      start = i
    }
    while (start < history.length && history[start]?.role === "tool") start++
    return history.slice(start)
  })()

  const allMessages: Message[] = [systemMessage, ...compactionMessage, ...sendHistory, userMessage]
  const resultHistory: Message[] = [...history, userMessage]
  yield { type: "message", message: userMessage }

  const tools = await runtime.runSync(Effect.gen(function* () {
    const r = yield* ToolRegistry
    return yield* r.all()
  }))
  const toolDefs = options.mode === "plan" ? [] : convertToolsToDefs(tools)

  const permanentPrefix: Message[] = [systemMessage, ...compactionMessage, userMessage]
  const currentTurnStart = allMessages.length

  for (let step = 0; step < 50; step++) {
    yield { type: "status", text: "thinking..." }
    let stream: ReadableStream<any> | undefined
    let lastError: unknown

    for (let attempt = 0; attempt <= retrySchedule.length; attempt++) {
      const requestMessages = step === 0
        ? allMessages
        : [...permanentPrefix, ...allMessages.slice(currentTurnStart)]

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
      if (!retry429 || !isRateLimitError(lastError) || attempt >= retrySchedule.length) break
      const wait = retrySchedule[attempt]
      yield { type: "status", text: `rate limited, retry in ${Math.round(wait / 1000)}s...` }
      yield { type: "notice", kind: "system", text: `rate limited, retrying in ${Math.round(wait / 1000)}s` }
      await delay(wait)
    }

    if (!stream) {
      const errorText = formatProviderError(lastError)
      yield { type: "notice", kind: "error", text: errorText }
      const errorMsg: Message = { role: "assistant", content: `Error: ${errorText}` }
      resultHistory.push(errorMsg)
      yield { type: "message", message: errorMsg }
      yield { type: "error", message: errorText }
      return resultHistory
    }

    let content = ""
    let reasoning = ""
    let hasReasoning = false
    let finishReason: string | null | undefined
    let lastUsageInput = 0
    let lastUsageOutput = 0
    let lastUsageCachedInput = 0
    const acc = new Map<number, AccToolCall>()
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
      } catch {
        // Reader was cancelled (e.g. by abort) or upstream errored mid-stream.
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
        content += value.delta.content
        yield { type: "text", content: value.delta.content }
        yield { type: "status", text: "generating..." }
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

    if (!options.abort.aborted && (lastUsageInput > 0 || lastUsageOutput > 0)) {
      yield { type: "usage", inputTokens: lastUsageInput, outputTokens: lastUsageOutput, cachedInputTokens: lastUsageCachedInput }
    }

    if (options.abort.aborted) {
      return resultHistory
    }

    const toolCalls: ToolCall[] | undefined = acc.size > 0
      ? [...acc.values()].map((a) => ({
          id: a.id ?? `call_${a.index ?? 0}`,
          type: "function" as const,
          function: { name: a.name, arguments: a.arguments },
        }))
      : undefined

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
      yield { type: "done" }
      return resultHistory
    }

    allMessages.push(assistantMessage)

    if (options.abort.aborted) {
      return resultHistory
    }

    for (const call of toolCalls) {
      if (options.abort.aborted) {
        return resultHistory
      }
      const name = call.function.name ?? "unknown"
      const def = tools.find((tool) => tool.id === name)
      if (!def) {
        const errorMsg = createToolMessage({ tool_call_id: call.id, tool: name, output: `Unknown tool: ${name}`, error: true })
        allMessages.push(errorMsg)
        resultHistory.push(errorMsg)
        yield { type: "tool_result", id: call.id, name, output: `Unknown tool: ${name}`, error: true }
        yield { type: "message", message: errorMsg }
        continue
      }

      yield { type: "status", text: `running tool: ${name}` }
      yield { type: "tool_start", id: call.id, name, input: call.function.arguments ?? "" }
      const result = await Effect.runPromise(
        def.execute(runtime.parseJson(call.function.arguments ?? "{}"), new Context({
          abort: options.abort,
          cwd: workdir,
          root: workdir,
          ask: (req) => Effect.tryPromise({
            try: () => runtime.ask(req),
            catch: (e) => new Error(String(e)),
          }) as Effect.Effect<void>,
          metadata: () => Effect.void,
        })).pipe(
          // Safety net: if a tool hangs (runaway command, network stall, etc.)
          // we time out after 5 minutes rather than locking the session forever.
          Effect.timeout(300_000),
          Effect.catchCause((cause) => Effect.succeed(new Result({ title: "Error", output: `Tool error: ${cause}` }))),
        ),
      )

      const text = convertToolResult(result)
      const isError = result.title === "Error"
      yield { type: "tool_result", id: call.id, name, output: text, error: isError }
      const toolMsg = createToolMessage({ tool_call_id: call.id, tool: name, output: text })
      allMessages.push(toolMsg)
      resultHistory.push(toolMsg)
      yield { type: "message", message: toolMsg }
    }

    yield { type: "status", text: "thinking..." }
  }

  yield { type: "done" }
  return resultHistory
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
  }, runtime)

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
        ui.scrollBottom()
        break
      case "reasoning":
        ui.streamReasoningChunk(chunk.content)
        ui.scrollBottom()
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
        ui.notify(chunk.text, chunk.kind)
        break
      case "usage":
        ui.onUsage?.(chunk.inputTokens, chunk.outputTokens, chunk.cachedInputTokens)
        break
      case "message":
        ui.addMessage(chunk.message)
        break
      case "error":
      case "done":
        break
    }
  }
}
