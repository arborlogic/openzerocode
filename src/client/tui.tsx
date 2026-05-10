import { For, createSignal, onCleanup, onMount } from "solid-js"
import { render, useTerminalDimensions } from "@opentui/solid"
import { Effect, Layer } from "effect"
import chalk from "chalk"
import { bigPickleLayer } from "../provider/index"
import { layer as toolLayer } from "../tool/registry"
import { ToolRegistry } from "../tool/registry"
import { Provider } from "../provider/types"
import type { Message, ToolCall } from "../provider/types"
import { Context, Result } from "../tool/tool"
import { convertToolsToDefs, convertToolResult } from "../core/convert"
import { renderMarkdown } from "./markdown"

const appLayer = Layer.merge(
  bigPickleLayer({
    apiKey: process.env.OPENCODE_API_KEY ?? "",
    model: process.env.OPENZERO_MODEL ?? "big-pickle",
  }),
  toolLayer,
)

const SYSTEM_PROMPT = [
  "You are openzerocode, an AI coding assistant.",
  "Use tools when the user asks you to perform actions.",
  "Be concise and helpful.",
].join("\n")

type AccToolCall = { id?: string; index?: number; name: string; arguments: string }

function runSync<E, A>(effect: Effect.Effect<A, E, ToolRegistry | Provider>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(appLayer)))
}

function parseJSON(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) } catch { return {} }
}

function App() {
  const dimensions = useTerminalDimensions()
  const [logs, setLogs] = createSignal<string[]>([])
  const [status, setStatus] = createSignal("idle")
  const [draft, setDraft] = createSignal([""])
  const [row, setRow] = createSignal(0)
  const [col, setCol] = createSignal(0)
  const [messages, setMessages] = createSignal<Message[]>([])
  const [running, setRunning] = createSignal(false)

  const append = (text: string) => setLogs((prev) => [...prev, ...text.split("\n")])

  const submit = async () => {
    if (running()) return
    const input = draft().join("\n").trim()
    if (!input) return
    setRunning(true)
    setStatus("thinking")
    append(chalk.hex("#98C379")("user") + ` ${input.split("\n")[0]}`)
    const next = await runSession(input, messages(), {
      append,
      setStatus,
    })
    setMessages(next)
    setDraft([""])
    setRow(0)
    setCol(0)
    setStatus("idle")
    setRunning(false)
  }

  onMount(() => {
    const input = process.stdin
    input.setEncoding("utf8")
    if (input.isTTY) input.setRawMode(true)

    const keyHandler = (buf: Buffer) => {
      const s = buf.toString("utf8")
      if (s === "\u0003") process.exit(0)
      if (running()) return
      if (s === "\r") {
        const current = draft()[row()] ?? ""
        if (!current && draft().join("\n").trim()) {
          void submit()
          return
        }
        const line = draft()[row()] ?? ""
        const head = line.slice(0, col())
        const tail = line.slice(col())
        setDraft((prev) => {
          const next = [...prev]
          next[row()] = head
          next.splice(row() + 1, 0, tail)
          return next
        })
        setRow((v) => v + 1)
        setCol(0)
        return
      }
      if (s === "\u007f") {
        const line = draft()[row()] ?? ""
        if (col() > 0) {
          setDraft((prev) => {
            const next = [...prev]
            next[row()] = line.slice(0, col() - 1) + line.slice(col())
            return next
          })
          setCol((v) => v - 1)
          return
        }
        if (row() > 0) {
          const prevLine = draft()[row() - 1] ?? ""
          setDraft((prev) => {
            const next = [...prev]
            next[row() - 1] = prevLine + line
            next.splice(row(), 1)
            return next
          })
          setRow((v) => v - 1)
          setCol(prevLine.length)
        }
        return
      }
      if (s === "\u001b[A") {
        if (row() > 0) setRow((v) => v - 1)
        return
      }
      if (s === "\u001b[B") {
        if (row() < draft().length - 1) setRow((v) => v + 1)
        return
      }
      if (s === "\u001b[D") {
        if (col() > 0) setCol((v) => v - 1)
        return
      }
      if (s === "\u001b[C") {
        const line = draft()[row()] ?? ""
        if (col() < line.length) setCol((v) => v + 1)
        return
      }
      if (s.startsWith("/")) {
        if (s.trim() === "/clear") {
          setLogs([])
          return
        }
      }
      if (s >= " " && s !== "\u007f") {
        const line = draft()[row()] ?? ""
        setDraft((prev) => {
          const next = [...prev]
          next[row()] = line.slice(0, col()) + s + line.slice(col())
          return next
        })
        setCol((v) => v + s.length)
      }
    }

    input.on("data", keyHandler)
    onCleanup(() => {
      input.off("data", keyHandler)
      if (input.isTTY) input.setRawMode(false)
    })
  })

  return (
    <box flexDirection="column" paddingLeft={1} paddingRight={1}>
      <text>{chalk.bold("OpenCode") + chalk.dim("  TUI")}</text>
      <text>{chalk.dim(`status: ${status()}  size:${dimensions().width}x${dimensions().height}`)}</text>
      <box border={true} borderColor="#3B4252" flexDirection="column" height={Math.max(8, dimensions().height - 10)}>
        <For each={logs().slice(-Math.max(6, dimensions().height - 12))}>{(line) => <text>{line}</text>}</For>
      </box>
      <box border={true} borderColor="#3B4252" flexDirection="column" height={4}>
        <For each={draft().slice(-3)}>{(line, i) => <text>{(row() === i() ? chalk.cyan("> ") : chalk.dim("  ")) + line}</text>}</For>
      </box>
      <text>{chalk.dim("empty line to submit  •  Ctrl+C exit  •  /clear")}</text>
    </box>
  )
}

async function runSession(
  userInput: string,
  history: Message[],
  ui: { append: (text: string) => void; setStatus: (text: string) => void },
): Promise<Message[]> {
  const systemMessage: Message = { role: "system", content: SYSTEM_PROMPT }
  const userMessage: Message = { role: "user", content: userInput }
  const allMessages: Message[] = [systemMessage, ...history, userMessage]
  const resultHistory: Message[] = [...history, userMessage]

  for (let step = 0; step < 20; step++) {
    const tools = await runSync(Effect.gen(function* () {
      const r = yield* ToolRegistry
      return yield* r.all()
    }))
    const toolDefs = convertToolsToDefs(tools)
    ui.setStatus("thinking")

    const stream = await runSync(Effect.gen(function* () {
      const p = yield* Provider
      return yield* p.stream({
        model: process.env.OPENZERO_MODEL ?? "big-pickle",
        messages: allMessages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        stream: true,
      })
    })).catch((error) => {
      ui.append(chalk.red(error instanceof Error ? error.message : String(error)))
      return undefined
    })
    if (!stream) return resultHistory

    let content = ""
    let reasoning = ""
    const acc = new Map<number, AccToolCall>()
    const reader = stream.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.delta.content) content += value.delta.content
      if (value.delta.reasoning_content) reasoning += value.delta.reasoning_content
      for (const tc of value.tool_calls ?? []) {
        const v = acc.get(tc.index ?? 0) ?? { name: "", arguments: "" }
        if (tc.id) v.id = tc.id
        if (tc.function?.name) v.name = tc.function.name
        if (tc.function?.arguments) v.arguments += tc.function.arguments
        if (tc.index !== undefined) v.index = tc.index
        acc.set(tc.index ?? 0, v)
      }
    }

    const toolCalls: ToolCall[] | undefined = acc.size
      ? [...acc.values()].map((a) => ({
          id: a.id ?? `call_${a.index ?? 0}`,
          type: "function" as const,
          function: { name: a.name, arguments: a.arguments },
        }))
      : undefined

    const assistantMsg: Message = {
      role: "assistant",
      content: content || undefined,
      reasoning_content: reasoning || undefined,
      tool_calls: toolCalls,
    }
    allMessages.push(assistantMsg)
    resultHistory.push(assistantMsg)

    if (!toolCalls) {
      if (content) ui.append(renderMarkdown(content))
      ui.append("")
      return resultHistory
    }

    if (content) ui.append(renderMarkdown(content))
    for (const call of toolCalls) {
      const name = call.function.name ?? "unknown"
      const def = tools.find((t) => t.id === name)
      if (!def) {
        allMessages.push({ role: "tool", tool_call_id: call.id, content: `Unknown tool: ${name}` })
        continue
      }
      ui.setStatus(`running tool: ${name}`)
      ui.append(chalk.hex("#C678DD")(`tool ${name}`))
      const result = await Effect.runPromise(def.execute(parseJSON(call.function.arguments ?? "{}"), new Context({
        abort: new AbortController().signal,
        cwd: process.cwd(),
        root: process.cwd(),
        ask: () => Effect.void,
        metadata: () => Effect.void,
      })).pipe(Effect.catchCause((cause) => Effect.succeed(new Result({ title: "Error", output: String(cause) })))))
      const text = convertToolResult(result)
      ui.append(chalk.dim(text.length > 300 ? text.slice(0, 300) + "..." : text))
      allMessages.push({ role: "tool", tool_call_id: call.id, content: text })
    }
  }

  return resultHistory
}

render(() => <App />).catch((error) => {
  console.error(error)
  process.exit(1)
})
