import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { render, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { ScrollBoxRenderable, TabSelectRenderable, TextareaRenderable, KeyBinding } from "@opentui/core"
import { Effect, Layer } from "effect"
import { spawn } from "node:child_process"
import { platform } from "os"
import { buildLayer, autoDetectProvider, PROVIDERS } from "../provider/index"
import { layer as toolLayer } from "../tool/registry"
import { ToolRegistry } from "../tool/registry"
import { Provider } from "../provider/types"
import type { Message } from "../provider/types"
import { renderMarkdown } from "./markdown"
import { loadSession, saveSession } from "./session-state"
import { createStreamState } from "./stream-state"
import { runSession, type RunMode } from "./session-runner"
import { SlashAutocomplete } from "./autocomplete"
import type { AutocompleteApi } from "./autocomplete"
import { BUILTIN_COMMANDS, executeCommand, type CommandContext } from "./commands"
import { Sidebar } from "./sidebar"

let currentProvider = autoDetectProvider() ?? "big-pickle"
let currentModel = process.env.OPENZERO_MODEL ?? "big-pickle"
let currentLayer = Layer.merge(buildLayer(currentProvider, currentModel), toolLayer)

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

export type DisplayBlock = {
  kind: "user" | "assistant" | "reasoning" | "tool" | "tool-call" | "error" | "system"
  text: string
  title?: string
}

function rebuildLayer() {
  currentLayer = Layer.merge(buildLayer(currentProvider, currentModel), toolLayer)
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

function App() {
  const dimensions = useTerminalDimensions()
  const sessionStart = new Date()
  const renderer = useRenderer()
  const initialMessages = loadSession()
  const [messages, setMessages] = createSignal(initialMessages)
  const [status, setStatus] = createSignal("waiting for input")
  const [draft, setDraft] = createSignal("")
  const [running, setRunning] = createSignal(false)
  const [mode, setMode] = createSignal<RunMode>("build")
  const [copyNotice, setCopyNotice] = createSignal(false)
  const [showPalette, setShowPalette] = createSignal(false)
  const [paletteIndex, setPaletteIndex] = createSignal(0)
  const streamState = createStreamState()
  const [notices, setNotices] = createSignal<DisplayBlock[]>([])
  let scroll: ScrollBoxRenderable | undefined
  let composer: TextareaRenderable | undefined
  let autocompleteApi: AutocompleteApi | undefined
  let modeTabs: TabSelectRenderable | undefined
  let exitTask: Promise<void> | undefined
  let runAbort: AbortController | undefined
  let history: string[] = []
  let historyIndex = -1
  let historyDraft = ""

  type PaletteItem = { label: string; hint?: string; onSelect: () => void }

  const paletteItems = createMemo<PaletteItem[]>(() => [
    { label: "model", hint: currentModel, onSelect: () => setShowPalette(false) },
    { label: "provider", hint: currentProvider, onSelect: () => setShowPalette(false) },
    { label: "mode", hint: mode(), onSelect: () => { setMode(m => m === "build" ? "plan" : "build"); setShowPalette(false) } },
    { label: "clear session", onSelect: () => { setMessages([]); saveSession([]); setShowPalette(false) } },
    { label: "exit", onSelect: () => { void exitApp(0) } },
  ])

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
      const ctx: CommandContext = {
        currentProvider,
        setCurrentProvider: (id) => { currentProvider = id; rebuildLayer() },
        currentModel,
        setCurrentModel: (name) => { currentModel = name; rebuildLayer() },
        mode: mode(),
        setMode,
        messages,
        setMessages,
        setDraft: setComposerText,
        setNotices,
        exitApp,
        scrollBottom,
      }
      executeCommand(input, ctx)
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
    if (event.ctrl && event.name === "p") {
      setShowPalette((open) => !open)
      setPaletteIndex(0)
      event.preventDefault()
      return
    }
    if (showPalette()) {
      if (event.name === "escape") {
        setShowPalette(false)
        event.preventDefault()
        return
      }
      if (event.name === "up") {
        setPaletteIndex(i => Math.max(0, i - 1))
        event.preventDefault()
        return
      }
      if (event.name === "down") {
        setPaletteIndex(i => Math.min(paletteItems().length - 1, i + 1))
        event.preventDefault()
        return
      }
      if (event.name === "return") {
        paletteItems()[paletteIndex()]?.onSelect()
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
      <box flexShrink={0} flexDirection="column" backgroundColor={THEME.headerBg} border={["bottom"]} borderColor={THEME.headerBorder}>
        <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} justifyContent="space-between" flexDirection="row">
          <text style={{ fg: THEME.accent }}>OpenZeroCode</text>
          <box flexDirection="row" gap={2}>
            <text style={{ fg: THEME.muted }}>{currentModel}</text>
            <Show when={copyNotice()}>
              <text style={{ fg: THEME.muted }}>copied</text>
            </Show>
          </box>
        </box>
        <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <text style={{ fg: THEME.muted }}>
            {status()}  •  {messages().length} messages  •  mode: {mode()}
          </text>
        </box>
      </box>

      <box flexDirection="row" flexGrow={1} minHeight={0}>
      <box flexDirection="column" flexGrow={1} minHeight={0}>
      <scrollbox
        ref={(node) => (scroll = node)}
        flexGrow={1}
        minHeight={0}
        stickyScroll={true}
        stickyStart="bottom"
        border={["left"]}
        borderColor={THEME.border}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        scrollY={true}
      >
        <For each={blocks()}>
          {(entry, index) => {
            const label = entry.kind === "assistant" ? "assistant"
              : entry.kind === "user" ? "you"
              : entry.kind === "reasoning" ? "think"
              : entry.kind === "error" ? "error"
              : entry.kind === "tool" ? "tool"
              : entry.kind === "tool-call" ? "call"
              : "system"
            const labelColor = entry.kind === "user" ? THEME.user
              : entry.kind === "reasoning" ? THEME.accent
              : entry.kind === "tool" || entry.kind === "tool-call" ? THEME.tool
              : entry.kind === "error" ? THEME.error
              : THEME.muted
            const borderColor = entry.kind === "user" ? THEME.user
              : entry.kind === "reasoning" ? THEME.accent
              : entry.kind === "tool" || entry.kind === "tool-call" ? THEME.tool
              : entry.kind === "error" ? THEME.error
              : THEME.border
            return (
              <box
                marginTop={index() === 0 ? 0 : 1}
                paddingLeft={2}
                paddingRight={1}
                paddingTop={1}
                paddingBottom={1}
                border={["left"]}
                borderColor={borderColor}
              >
                <box flexDirection="column" gap={1}>
                  <text style={{ fg: labelColor }}>
                    {label}{entry.title ? ` ${entry.title}` : ""}
                  </text>
                  <text style={{ fg: entry.kind === "reasoning" || entry.kind === "system" ? THEME.muted : THEME.text }}>
                    {entry.text}
                  </text>
                </box>
              </box>
            )
          }}
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
        <box height={1} border={["left"]} borderColor={THEME.border}>
          <box width="100%" border={["bottom"]} borderColor={THEME.surface} />
        </box>
      </box>
      </box>

      <Sidebar
        messages={messages}
        sessionStart={sessionStart}
        theme={THEME}
        width={SIDEBAR_WIDTH}
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
          top={Math.floor((dimensions().height - paletteItems().length - 6) / 2)}
          left={Math.floor((dimensions().width - 2 - 52) / 2)}
          width={52}
          zIndex={100}
          backgroundColor={THEME.surface}
          border={["top", "left", "right", "bottom"]}
          borderColor={THEME.accent}
          flexDirection="column"
        >
          <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
            <text style={{ fg: THEME.accent }}>Command Palette</text>
            <text style={{ fg: THEME.muted }}>  Ctrl+P</text>
          </box>
          <box border={["top"]} borderColor={THEME.border} flexDirection="column">
            <For each={paletteItems()}>
              {(item, index) => (
                <box
                  paddingLeft={2}
                  paddingRight={2}
                  paddingTop={0}
                  paddingBottom={0}
                  backgroundColor={index() === paletteIndex() ? THEME.accentDim : undefined}
                  onMouseMove={() => setPaletteIndex(index())}
                  onMouseDown={() => { setPaletteIndex(index()); item.onSelect() }}
                  flexDirection="row"
                  gap={2}
                >
                  <text style={{ fg: index() === paletteIndex() ? "#ffffff" : THEME.text }}>
                    {item.label}
                  </text>
                  <Show when={item.hint}>
                    <text style={{ fg: index() === paletteIndex() ? THEME.border : THEME.muted }}>
                      {item.hint}
                    </text>
                  </Show>
                </box>
              )}
            </For>
          </box>
          <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} border={["top"]} borderColor={THEME.border}>
            <text style={{ fg: THEME.muted }}>↑↓ navigate  •  Enter select  •  Esc close</text>
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
