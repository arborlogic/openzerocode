import { Effect } from "effect"
import { ToolRegistry } from "../tool/registry"
import { Provider } from "../provider/types"
import type { Message, ToolCall } from "../provider/types"
import { createAssistantMessage, createToolMessage } from "../provider/message-parts"
import { Context, Result } from "../tool/tool"
import { convertToolsToDefs, convertToolResult } from "../core/convert"
import { delay, formatProviderError, isRateLimitError } from "./errors"

type AccToolCall = { id?: string; index?: number; name: string; arguments: string }
export type RunMode = "build" | "plan"

type SessionUi = {
  abort: AbortSignal
  streamReasoningChunk: (text: string) => void
  streamAssistantChunk: (text: string) => void
  addMessage: (msg: Message) => void
  notify: (text: string, kind: string) => void
  setStatus: (text: string) => void
  scrollBottom: () => void
  model: string
  mode: RunMode
}

type SessionRuntime = {
  runSync: <E, A>(effect: Effect.Effect<A, E, ToolRegistry | Provider>) => Promise<A>
  systemPrompt: (mode: RunMode) => string
  parseJson: (raw: string) => Record<string, unknown>
}

export async function runSession(
  userInput: string,
  history: Message[],
  ui: SessionUi,
  runtime: SessionRuntime,
): Promise<Message[]> {
  const retry429 = ["true", "1", "yes"].includes((process.env.OPENZEROCODE_RETRY_429 ?? "").toLowerCase())
  const retrySchedule = [2000, 5000, 10000]
  const systemMessage: Message = { role: "system", content: runtime.systemPrompt(ui.mode) }
  const userMessage: Message = { role: "user", content: userInput }
  const allMessages: Message[] = [systemMessage, ...history, userMessage]
  const resultHistory: Message[] = [...history, userMessage]
  ui.addMessage(userMessage)

  const tools = await runtime.runSync(Effect.gen(function* () {
    const r = yield* ToolRegistry
    return yield* r.all()
  }))
  const toolDefs = ui.mode === "plan" ? [] : convertToolsToDefs(tools)

  for (let step = 0; step < 50; step++) {
    ui.setStatus("thinking...")
    let stream: ReadableStream<any> | undefined
    let lastError: unknown

    for (let attempt = 0; attempt <= retrySchedule.length; attempt++) {
      stream = await runtime.runSync(Effect.gen(function* () {
        const p = yield* Provider
        return yield* p.stream({
          model: ui.model,
          messages: allMessages,
          tools: toolDefs.length > 0 ? toolDefs : undefined,
          stream: true,
        })
      })).catch((error) => {
        lastError = error
        return undefined
      })
      if (stream) break
      if (!retry429 || !isRateLimitError(lastError) || attempt >= retrySchedule.length) break
      const wait = retrySchedule[attempt]
      ui.setStatus(`rate limited, retry in ${Math.round(wait / 1000)}s...`)
      ui.notify(`rate limited, retrying in ${Math.round(wait / 1000)}s`, "system")
      await delay(wait)
    }

    if (!stream) {
      ui.setStatus("waiting for input")
      ui.notify(formatProviderError(lastError), "error")
      return resultHistory
    }

    let content = ""
    let reasoning = ""
    const acc = new Map<number, AccToolCall>()
    const reader = stream.getReader()
    while (true) {
      if (ui.abort.aborted) break
      const { done, value } = await reader.read()
      if (done) break
      if (value.delta.content) {
        content += value.delta.content
        ui.streamAssistantChunk(value.delta.content)
        ui.setStatus("generating...")
        ui.scrollBottom()
      }
      if (value.delta.reasoning_content) {
        reasoning += value.delta.reasoning_content
        ui.streamReasoningChunk(value.delta.reasoning_content)
        ui.setStatus("reasoning...")
        ui.scrollBottom()
      }
      for (const tc of value.tool_calls ?? []) {
        const next = acc.get(tc.index ?? 0) ?? { name: "", arguments: "" }
        if (tc.id) next.id = tc.id
        if (tc.function?.name) next.name = tc.function.name
        if (tc.function?.arguments) next.arguments += tc.function.arguments
        if (tc.index !== undefined) next.index = tc.index
        acc.set(tc.index ?? 0, next)
      }
    }

    if (ui.abort.aborted) {
      ui.setStatus("waiting for input")
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
      reasoning_content: reasoning || undefined,
      tool_calls: toolCalls,
    })
    allMessages.push(assistantMessage)
    resultHistory.push(assistantMessage)
    ui.addMessage(assistantMessage)

    if (!toolCalls) {
      ui.setStatus("waiting for input")
      return resultHistory
    }

    if (ui.abort.aborted) {
      ui.setStatus("waiting for input")
      return resultHistory
    }

    for (const call of toolCalls) {
      if (ui.abort.aborted) {
        ui.setStatus("waiting for input")
        return resultHistory
      }
      const name = call.function.name ?? "unknown"
      const def = tools.find((tool) => tool.id === name)
      if (!def) {
        const errorMsg = createToolMessage({ tool_call_id: call.id, tool: name, output: `Unknown tool: ${name}`, error: true })
        allMessages.push(errorMsg)
        resultHistory.push(errorMsg)
        ui.addMessage(errorMsg)
        continue
      }

      ui.setStatus(`running tool: ${name}`)
      const result = await Effect.runPromise(
        def.execute(runtime.parseJson(call.function.arguments ?? "{}"), new Context({
          abort: ui.abort,
          cwd: process.cwd(),
          root: process.cwd(),
          ask: () => Effect.void,
          metadata: () => Effect.void,
        })).pipe(Effect.catchCause((cause) => Effect.succeed(new Result({ title: "Error", output: `Tool error: ${cause}` })))),
      )

      const text = convertToolResult(result)
      const toolMsg = createToolMessage({ tool_call_id: call.id, tool: name, output: text })
      allMessages.push(toolMsg)
      resultHistory.push(toolMsg)
      ui.addMessage(toolMsg)
      ui.scrollBottom()
    }

    ui.setStatus("thinking...")
  }

  return resultHistory
}
