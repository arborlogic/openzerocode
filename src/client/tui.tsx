import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { KeyBinding, ScrollBoxRenderable, TabSelectRenderable, TextareaRenderable } from "@opentui/core"
import { Effect, Layer } from "effect"
import { spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { homedir, platform } from "os"
import { bigPickleLayer } from "../provider/index"
import { layer as toolLayer } from "../tool/registry"
import { ToolRegistry } from "../tool/registry"
import { Provider } from "../provider/types"
import type { Message, ToolCall } from "../provider/types"
import { Context, Result } from "../tool/tool"
import { convertToolsToDefs, convertToolResult } from "../core/convert"
import { delay, formatProviderError, isRateLimitError } from "./errors"
import { renderMarkdown } from "./markdown"

let currentModel = process.env.OPENZERO_MODEL ?? "big-pickle"

const appLayer = Layer.merge(
  bigPickleLayer({
    apiKey: process.env.OPENCODE_API_KEY ?? "",
    model: currentModel,
  }),
  toolLayer,
)

const SYSTEM_PROMPT = [
  "You are OpenZeroCode, an AI coding assistant.",
  "You have access to tools for reading, writing, searching files and running shell commands.",
  "Use tools when the user asks you to perform actions like running commands or accessing files.",
  "For simple conversation or questions, just respond directly without tools.",
  "Be concise and helpful.",
].join("\n")

const SESSION_DIR = join(homedir(), ".openzerocode", "sessions")
const SESSION_FILE = join(SESSION_DIR, "last.json")
const THEME = {
  background: "#101010",
  surface: "#151515",
  panel: "#111111",
  border: "#2a2a2a",
  text: "#eeeeee",
  muted: "#8f8f8f",
  accent: "#58a6ff",
  user: "#7cc7ff",
  tool: "#bc8cff",
  error: "#f85149",
}
const EMPTY_STATE_MESSAGE = "Response scroll is locked inside the panel. Mouse wheel scrolls response only."
const SCROLL_HINT = "Enter submit  •  Shift/Ctrl/Alt+Enter newline  •  Wheel scrolls response only  •  PgUp/PgDn Ctrl+B/F Home/End"
const PROMPT_KEY_BINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "return", ctrl: true, action: "newline" },
  { name: "return", meta: true, action: "newline" },
  { name: "j", ctrl: true, action: "newline" },
]
const MODE_OPTIONS = [
  { name: "Build", description: "Write code and use tools", value: "build" as const },
  { name: "Plan", description: "Discuss approach without coding", value: "plan" as const },
]

type LogEntry = {
  role: "system" | "user" | "assistant" | "tool" | "error" | "reasoning"
  text: string
  title?: string
}

type AccToolCall = { id?: string; index?: number; name: string; arguments: string }
type RunMode = "build" | "plan"

function ensureSessionDir() {
  if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true })
}

function saveSession(messages: Message[]) {
  ensureSessionDir()
  writeFileSync(SESSION_FILE, JSON.stringify({ messages, updatedAt: Date.now() }), "utf-8")
}

function sanitizeMessages(messages: Message[]): Message[] {
  const out: Message[] = []
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]
    if (msg?.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      const requiredIds = new Set(msg.tool_calls.map((tc) => tc.id))
      const toolMsgs: Message[] = []
      let j = i + 1
      while (j < messages.length && messages[j]?.role === "tool") {
        toolMsgs.push(messages[j]!)
        j++
      }
      const foundIds = new Set(toolMsgs.map((m) => m.tool_call_id).filter(Boolean))
      if ([...requiredIds].every((id) => foundIds.has(id))) {
        out.push(msg)
        for (const tm of toolMsgs) out.push(tm)
      }
      i = j
      continue
    }
    if (msg) out.push(msg)
    i++
  }
  return out
}

function loadSession(): Message[] {
  try {
    if (!existsSync(SESSION_FILE)) return []
    const data = readFileSync(SESSION_FILE, "utf-8")
    const raw: Message[] = JSON.parse(data).messages ?? []
    return sanitizeMessages(raw)
  } catch {
    return []
  }
}

function runSync<E, A>(effect: Effect.Effect<A, E, ToolRegistry | Provider>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(appLayer)))
}

function tryParseJSON(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) } catch { return {} }
}

function stripAnsi(str: string) {
  return str.replace(/\x1b\[[0-9;]*m/g, "")
}

function helpLines() {
  return [
    "Commands:",
    "  /help          show this help",
    "  /clear         clear conversation history",
    "  /info          show session info",
    "  /model <name>  switch model",
    "  /mode <name>   switch build/plan mode",
    "  /exit          exit program",
    "Scroll:",
    "  mouse wheel scrolls the response area only",
    "  PgUp/PgDn scroll response",
    "  Home/End jump to top/bottom",
  ]
}

function appendLogEntry(
  setLogs: (value: (prev: LogEntry[]) => LogEntry[]) => void,
  role: LogEntry["role"],
  text: string,
  title?: string,
) {
  const value = stripAnsi(text).trimEnd()
  if (!value) return
  setLogs((prev) => [...prev, { role, text: value, title }])
}

function renderAssistantText(text: string) {
  const rendered = renderMarkdown(text).trim()
  return rendered || text
}

function initialLogs(messages: Message[]) {
  if (messages.length > 0) {
    return [{ role: "system", text: `Resumed session with ${messages.length} message(s). /clear to reset.` } satisfies LogEntry]
  }
  return [{ role: "system", text: EMPTY_STATE_MESSAGE } satisfies LogEntry]
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
  if (mode === "plan") {
    return [
      SYSTEM_PROMPT,
      "You are currently in Plan mode.",
      "Do not write code, do not call tools, and do not make changes.",
      "Explain the approach, risks, and step-by-step plan only.",
    ].join("\n")
  }
  return SYSTEM_PROMPT
}

function App() {
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const initialMessages = loadSession()
  const [logs, setLogs] = createSignal<LogEntry[]>(initialLogs(initialMessages))
  const [status, setStatus] = createSignal("waiting for input")
  const [draft, setDraft] = createSignal("")
  const [messages, setMessages] = createSignal(initialMessages)
  const [running, setRunning] = createSignal(false)
  const [sessionCount, setSessionCount] = createSignal(initialMessages.length)
  const [mode, setMode] = createSignal<RunMode>("build")
  const [copyNotice, setCopyNotice] = createSignal(false)
  let scroll: ScrollBoxRenderable | undefined
  let composer: TextareaRenderable | undefined
  let modeTabs: TabSelectRenderable | undefined
  let exitTask: Promise<void> | undefined
  let runAbort: AbortController | undefined
  let history: string[] = []
  let historyIndex = -1
  let historyDraft = ""
  let reasoningStreamIndex: number | undefined
  let streamingIndex: number | undefined

  const append = (role: LogEntry["role"], text: string, title?: string) => {
    appendLogEntry(setLogs, role, text, title)
  }

  const streamReasoningChunk = (text: string) => {
    setLogs((prev) => {
      if (reasoningStreamIndex === undefined) {
        const insertAt = streamingIndex !== undefined ? streamingIndex : prev.length
        const next = [...prev]
        next.splice(insertAt, 0, { role: "reasoning", text, title: "Thinking" } satisfies LogEntry)
        reasoningStreamIndex = insertAt
        if (streamingIndex !== undefined && streamingIndex >= insertAt) {
          streamingIndex += 1
        }
        return next
      }

      const next = [...prev]
      const current = next[reasoningStreamIndex]
      if (!current) return prev
      next[reasoningStreamIndex] = { ...current, text: current.text + text }
      return next
    })
  }

  const finalizeReasoningStream = (text: string) => {
    const finalText = stripAnsi(text).trim()
    setLogs((prev) => {
      if (reasoningStreamIndex === undefined) {
        if (!finalText) return prev
        const insertAt = streamingIndex !== undefined ? streamingIndex : prev.length
        const next = [...prev]
        next.splice(insertAt, 0, { role: "reasoning", text: finalText, title: "Thinking" })
        if (streamingIndex !== undefined && streamingIndex >= insertAt) {
          streamingIndex += 1
        }
        return next
      }

      const next = [...prev]
      if (!finalText) {
        next.splice(reasoningStreamIndex, 1)
        if (streamingIndex !== undefined && streamingIndex > reasoningStreamIndex) {
          streamingIndex -= 1
        }
        reasoningStreamIndex = undefined
        return next
      }

      const current = next[reasoningStreamIndex]
      if (!current) {
        reasoningStreamIndex = undefined
        return prev
      }

      next[reasoningStreamIndex] = { ...current, text: finalText, title: "Thinking" }
      reasoningStreamIndex = undefined
      return next
    })
  }

  const streamAssistantChunk = (text: string) => {
    setLogs((prev) => {
      if (streamingIndex === undefined) {
        const insertAt = reasoningStreamIndex !== undefined ? reasoningStreamIndex + 1 : prev.length
        const next = [...prev]
        next.splice(insertAt, 0, { role: "assistant", text })
        streamingIndex = insertAt
        return next
      }
      const next = [...prev]
      const current = next[streamingIndex]
      if (!current) return prev
      next[streamingIndex] = { ...current, text: current.text + text }
      return next
    })
  }

  const finalizeAssistantStream = (text: string) => {
    const finalText = renderAssistantText(text)
    setLogs((prev) => {
      if (streamingIndex === undefined) {
        return finalText ? [...prev, { role: "assistant", text: finalText }] : prev
      }
      const next = [...prev]
      if (!finalText) {
        next.splice(streamingIndex, 1)
        streamingIndex = undefined
        return next
      }
      const current = next[streamingIndex]
      if (!current) {
        streamingIndex = undefined
        return prev
      }
      next[streamingIndex] = { ...current, text: finalText }
      streamingIndex = undefined
      return next
    })
  }

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

  createEffect(() => {
    modeTabs?.setSelectedIndex(mode() === "build" ? 0 : 1)
  })

  const submit = async () => {
    if (running()) return
    const input = draft().trim()
    if (!input) return

    if (input.startsWith("/")) {
      if (input.startsWith("/model")) {
        const arg = input.slice(6).trim()
        if (arg) {
          currentModel = arg
          append("tool", `model -> ${currentModel}`)
        } else {
          append("system", `Current model: ${currentModel}`)
        }
      } else if (input.startsWith("/mode")) {
        const arg = input.slice(5).trim().toLowerCase()
        if (arg === "build" || arg === "plan") {
          setMode(arg)
          append("system", `Mode switched to ${arg}.`)
        } else if (!arg) {
          append("system", `Current mode: ${mode()}`)
        } else {
          append("error", "Usage: /mode build|plan")
        }
      } else if (input === "/help") {
        for (const line of helpLines()) append("system", line)
      } else if (input === "/clear") {
        setLogs([{ role: "system", text: "History cleared." }])
        setMessages([])
        setSessionCount(0)
        saveSession([])
        setComposerText("")
      } else if (input === "/info") {
        append("system", `Messages: ${messages().length}, Session: ${SESSION_FILE}`)
      } else if (input === "/exit" || input === "/quit") {
        await exitApp(0)
        return
      } else {
        append("error", `Unknown command: ${input}. Type /help`)
      }
      setComposerText("")
      queueMicrotask(scrollBottom)
      return
    }

    history = [input, ...history.filter((item) => item !== input)].slice(0, 100)
    historyIndex = -1
    historyDraft = ""

    runAbort = new AbortController()
    setRunning(true)
    setStatus("thinking...")
    append("user", input)
    queueMicrotask(scrollBottom)

    try {
      const next = await runSession(input, messages(), {
        abort: runAbort.signal,
        append,
        streamReasoningChunk,
        finalizeReasoningStream,
        streamAssistantChunk,
        finalizeAssistantStream,
        setStatus,
        scrollBottom,
        model: currentModel,
        mode: mode(),
      })

      setMessages(next)
      setSessionCount(next.length)
      saveSession(next)
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
    if (event.name === "escape") {
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
    if (composer && !running() && event.name === "up" && composer.cursorOffset === 0 && history.length > 0) {
      if (historyIndex === -1) historyDraft = composer.plainText
      historyIndex = Math.min(historyIndex + 1, history.length - 1)
      setComposerText(history[historyIndex] ?? "")
      event.preventDefault()
      return
    }
    if (composer && !running() && event.name === "down" && historyIndex >= 0 && composer.cursorOffset === composer.plainText.length) {
      historyIndex--
      setComposerText(historyIndex >= 0 ? (history[historyIndex] ?? "") : historyDraft)
      event.preventDefault()
      return
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
      <box flexShrink={0} flexDirection="column" paddingTop={1} paddingBottom={1} backgroundColor={THEME.surface}>
        <box paddingLeft={1} paddingRight={1} justifyContent="space-between" flexDirection="row">
          <text style={{ fg: THEME.text }}>OpenZeroCode</text>
          <Show when={copyNotice()}>
            <text style={{ fg: THEME.muted }}>Copy</text>
          </Show>
        </box>
        <box paddingLeft={1} paddingRight={1}>
          <text style={{ fg: THEME.muted }}>model: {currentModel}  •  status: {status()}  •  messages: {sessionCount()}</text>
        </box>
      </box>

      <scrollbox
        ref={(node) => (scroll = node)}
        flexGrow={1}
        minHeight={0}
        stickyScroll={true}
        stickyStart="bottom"
        border={true}
        borderColor={THEME.border}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
        scrollY={true}
      >
        <For each={logs()}>
          {(entry, index) => (
            <box
              marginTop={index() === 0 ? 0 : 1}
              paddingLeft={entry.role === "assistant" ? 2 : 1}
              paddingRight={1}
              paddingTop={1}
              paddingBottom={1}
              backgroundColor={entry.role === "assistant" ? THEME.background : THEME.panel}
              border={entry.role === "assistant" ? undefined : ["left"]}
              borderColor={entry.role === "user"
                ? THEME.user
                : entry.role === "reasoning"
                  ? THEME.accent
                : entry.role === "tool"
                  ? THEME.tool
                  : entry.role === "error"
                    ? THEME.error
                    : THEME.border}
            >
              <box flexDirection="column">
                <Show
                  when={entry.title}
                  fallback={
                    <>
                      <text
                        style={{
                          fg: entry.role === "user"
                            ? THEME.user
                            : entry.role === "reasoning"
                              ? THEME.accent
                            : entry.role === "assistant"
                              ? THEME.accent
                              : entry.role === "error"
                                ? THEME.error
                                : THEME.muted,
                        }}
                      >
                        {entry.role === "assistant"
                          ? "assistant"
                          : entry.role === "user"
                            ? "you"
                            : entry.role === "reasoning"
                              ? "thinking"
                            : entry.role === "error"
                              ? "error"
                              : "system"}
                      </text>
                      <text style={{ fg: entry.role === "system" ? THEME.muted : THEME.text }}>{entry.text}</text>
                    </>
                  }
                >
                  <>
                    <text style={{ fg: entry.role === "tool" ? THEME.tool : THEME.accent }}>
                      {entry.role === "tool" ? "tool" : "thinking"}  {entry.title}
                    </text>
                    <box marginTop={1} paddingLeft={1} border={["left"]} borderColor={THEME.border}>
                      <text style={{ fg: entry.role === "reasoning" ? THEME.muted : THEME.text }}>{entry.text}</text>
                    </box>
                  </>
                </Show>
              </box>
            </box>
          )}
        </For>
      </scrollbox>

      <box flexShrink={0} flexDirection="column" paddingTop={1}>
        <box border={["left"]} borderColor={THEME.accent}>
          <box flexDirection="column" backgroundColor={THEME.surface} paddingLeft={2} paddingRight={2} paddingTop={1}>
            <textarea
              initialValue={draft()}
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
              focused={true}
              ref={(node) => {
                composer = node
              }}
              onContentChange={() => setDraft(composer?.plainText ?? "")}
              onSubmit={() => { void submit() }}
            />
            <box paddingTop={1} paddingBottom={1} flexDirection="column" gap={1}>
              <tab_select
                ref={(node) => {
                  modeTabs = node
                }}
                options={MODE_OPTIONS}
                showDescription={false}
                showUnderline={true}
                wrapSelection={false}
                backgroundColor={THEME.surface}
                textColor={THEME.muted}
                focusedBackgroundColor={THEME.surface}
                focusedTextColor={THEME.text}
                selectedBackgroundColor={THEME.panel}
                selectedTextColor={THEME.text}
                selectedDescriptionColor={THEME.text}
                onChange={(_index, option) => {
                  const next = option?.value
                  if (next === "build" || next === "plan") setMode(next)
                }}
              />
              <text style={{ fg: THEME.muted }}>{currentModel}  •  mode: {mode()}  •  {SCROLL_HINT}</text>
            </box>
          </box>
        </box>
        <box height={1} border={["left"]} borderColor={THEME.accent}>
          <box width="100%" border={["bottom"]} borderColor={THEME.surface} />
        </box>
      </box>
    </box>
  )
}

async function runSession(
  userInput: string,
  history: Message[],
  ui: {
    abort: AbortSignal
    append: (role: LogEntry["role"], text: string, title?: string) => void
    streamReasoningChunk: (text: string) => void
    finalizeReasoningStream: (text: string) => void
    streamAssistantChunk: (text: string) => void
    finalizeAssistantStream: (text: string) => void
    setStatus: (text: string) => void
    scrollBottom: () => void
    model: string
    mode: RunMode
  },
): Promise<Message[]> {
  const retry429 = ["true", "1", "yes"].includes((process.env.OPENZEROCODE_RETRY_429 ?? "").toLowerCase())
  const retrySchedule = [2000, 5000, 10000]
  const systemMessage: Message = { role: "system", content: systemPrompt(ui.mode) }
  const userMessage: Message = { role: "user", content: userInput }
  const allMessages: Message[] = [systemMessage, ...history, userMessage]
  const resultHistory: Message[] = [...history, userMessage]

  for (let step = 0; step < 50; step++) {
    const tools = await runSync(Effect.gen(function* () {
      const r = yield* ToolRegistry
      return yield* r.all()
    }))
    const toolDefs = ui.mode === "plan" ? [] : convertToolsToDefs(tools)
    ui.setStatus("thinking...")
    let stream: ReadableStream<any> | undefined
    let lastError: unknown

    for (let attempt = 0; attempt <= retrySchedule.length; attempt++) {
      stream = await runSync(Effect.gen(function* () {
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
      ui.append("tool", `rate limited, retrying in ${Math.round(wait / 1000)}s`)
      await delay(wait)
    }

    if (!stream) {
      ui.setStatus("waiting for input")
      ui.append("error", formatProviderError(lastError))
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

    ui.finalizeReasoningStream(reasoning)
    ui.finalizeAssistantStream(content)

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

    const assistantMessage: Message = {
      role: "assistant",
      content: content || undefined,
      reasoning_content: reasoning || undefined,
      tool_calls: toolCalls,
    }
    allMessages.push(assistantMessage)
    resultHistory.push(assistantMessage)

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
        ui.append("error", `unknown tool: ${name}`)
        allMessages.push({ role: "tool", tool_call_id: call.id, content: `Unknown tool: ${name}` })
        continue
      }

      ui.setStatus(`running tool: ${name}`)
      const result = await Effect.runPromise(
        def.execute(tryParseJSON(call.function.arguments ?? "{}"), new Context({
          abort: ui.abort,
          cwd: process.cwd(),
          root: process.cwd(),
          ask: () => Effect.void,
          metadata: () => Effect.void,
        })).pipe(Effect.catchCause((cause) => Effect.succeed(new Result({ title: "Error", output: `Tool error: ${cause}` })))),
      )

      const text = convertToolResult(result)
      ui.append("tool", text.trim() || "(no output)", name)
      ui.scrollBottom()
      allMessages.push({ role: "tool", tool_call_id: call.id, content: text })
    }

    ui.setStatus("thinking...")
  }

  return resultHistory
}

render(() => <App />).catch((error) => {
  console.error(error)
  process.exit(1)
})
