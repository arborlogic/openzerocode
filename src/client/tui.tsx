import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { KeyBinding, ScrollBoxRenderable, TabSelectRenderable, TextareaRenderable } from "@opentui/core"
import { Effect, Layer } from "effect"
import { spawn } from "node:child_process"
import { platform } from "os"
import { bigPickleLayer } from "../provider/index"
import { layer as toolLayer } from "../tool/registry"
import { ToolRegistry } from "../tool/registry"
import { Provider } from "../provider/types"
import type { Message } from "../provider/types"
import { renderMarkdown } from "./markdown"
import { loadSession, saveSession, SESSION_FILE } from "./session-state"
import { createStreamState } from "./stream-state"
import { runSession, type RunMode } from "./session-runner"

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

type DisplayBlock = {
  kind: "user" | "assistant" | "reasoning" | "tool" | "tool-call" | "error" | "system"
  text: string
  title?: string
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

function renderAssistantText(text: string) {
  const rendered = renderMarkdown(text).trim()
  return rendered || text
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
            return { kind: "tool", text: part.output, title: part.tool }
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

function App() {
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const initialMessages = loadSession()
  const [messages, setMessages] = createSignal(initialMessages)
  const [status, setStatus] = createSignal("waiting for input")
  const [draft, setDraft] = createSignal("")
  const [running, setRunning] = createSignal(false)
  const [sessionCount, setSessionCount] = createSignal(initialMessages.length)
  const [mode, setMode] = createSignal<RunMode>("build")
  const [copyNotice, setCopyNotice] = createSignal(false)
  const streamState = createStreamState()
  const [notices, setNotices] = createSignal<DisplayBlock[]>([])
  let scroll: ScrollBoxRenderable | undefined
  let composer: TextareaRenderable | undefined
  let modeTabs: TabSelectRenderable | undefined
  let exitTask: Promise<void> | undefined
  let runAbort: AbortController | undefined
  let history: string[] = []
  let historyIndex = -1
  let historyDraft = ""

  const blocks = createMemo(() => {
    const result: DisplayBlock[] = []
    for (const msg of messages()) {
      result.push(...messageToBlocks(msg))
    }
    for (const n of notices()) {
      result.push(n)
    }
    if (running()) {
      for (const part of streamState.parts()) {
        if (part.type === "reasoning") {
          const text = stripAnsi(part.text).trim()
          if (text) result.push({ kind: "reasoning", text, title: "Thinking" })
        } else if (part.type === "text") {
          const rendered = renderAssistantText(part.text)
          result.push({ kind: "assistant", text: rendered })
        }
      }
    }
    if (result.length === 0) {
      result.push({ kind: "system", text: EMPTY_STATE_MESSAGE })
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
          setNotices((prev) => [...prev, { kind: "tool", text: `model -> ${currentModel}` }])
        } else {
          setNotices((prev) => [...prev, { kind: "system", text: `Current model: ${currentModel}` }])
        }
      } else if (input.startsWith("/mode")) {
        const arg = input.slice(5).trim().toLowerCase()
        if (arg === "build" || arg === "plan") {
          setMode(arg)
          setNotices((prev) => [...prev, { kind: "system", text: `Mode switched to ${arg}.` }])
        } else if (!arg) {
          setNotices((prev) => [...prev, { kind: "system", text: `Current mode: ${mode()}` }])
        } else {
          setNotices((prev) => [...prev, { kind: "error", text: "Usage: /mode build|plan" }])
        }
      } else if (input === "/help") {
        for (const line of helpLines()) setNotices((prev) => [...prev, { kind: "system", text: line }])
      } else if (input === "/clear") {
        setMessages([])
        setNotices([])
        setSessionCount(0)
        saveSession([])
        setComposerText("")
      } else if (input === "/info") {
        setNotices((prev) => [...prev, { kind: "system", text: `Messages: ${messages().length}, Session: ${SESSION_FILE}` }])
      } else if (input === "/exit" || input === "/quit") {
        await exitApp(0)
        return
      } else {
        setNotices((prev) => [...prev, { kind: "error", text: `Unknown command: ${input}. Type /help` }])
      }
      setComposerText("")
      queueMicrotask(scrollBottom)
      return
    }

    history = [input, ...history.filter((item) => item !== input)].slice(0, 100)
    historyIndex = -1
    historyDraft = ""

    queueMicrotask(scrollBottom)

    runAbort = new AbortController()
    streamState.reset()
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
        <For each={blocks()}>
          {(entry, index) => (
            <box
              marginTop={index() === 0 ? 0 : 1}
              paddingLeft={entry.kind === "assistant" ? 2 : 1}
              paddingRight={1}
              paddingTop={1}
              paddingBottom={1}
              backgroundColor={entry.kind === "assistant" ? THEME.background : THEME.panel}
              border={entry.kind === "assistant" ? undefined : ["left"]}
              borderColor={entry.kind === "user"
                ? THEME.user
                : entry.kind === "reasoning"
                  ? THEME.accent
                : entry.kind === "tool" || entry.kind === "tool-call"
                  ? THEME.tool
                  : entry.kind === "error"
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
                          fg: entry.kind === "user"
                            ? THEME.user
                            : entry.kind === "reasoning"
                              ? THEME.accent
                            : entry.kind === "assistant"
                              ? THEME.accent
                              : entry.kind === "error"
                                ? THEME.error
                                : THEME.muted,
                        }}
                      >
                        {entry.kind === "assistant"
                          ? "assistant"
                          : entry.kind === "user"
                            ? "you"
                            : entry.kind === "reasoning"
                              ? "thinking"
                            : entry.kind === "error"
                              ? "error"
                              : "system"}
                      </text>
                      <text style={{ fg: entry.kind === "system" ? THEME.muted : THEME.text }}>{entry.text}</text>
                    </>
                  }
                >
                  <>
                    <text style={{ fg: entry.kind === "tool" || entry.kind === "tool-call" ? THEME.tool : THEME.accent }}>
                      {entry.kind === "tool" ? "tool" : entry.kind === "tool-call" ? "tool call" : "thinking"}  {entry.title}
                    </text>
                    <box marginTop={1} paddingLeft={1} border={["left"]} borderColor={THEME.border}>
                      <text style={{ fg: entry.kind === "reasoning" ? THEME.muted : THEME.text }}>{entry.text}</text>
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

render(() => <App />).catch((error) => {
  console.error(error)
  process.exit(1)
})
