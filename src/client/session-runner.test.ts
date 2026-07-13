import { test } from "node:test"
import assert from "node:assert/strict"
import { Effect, Layer, Schema } from "effect"
import { runSession, streamSession } from "./session-runner"
import { Provider } from "../provider/types"
import { ToolRegistry } from "../tool/registry"
import { Def, Result } from "../tool/types"
import type { CompletionRequest, Message } from "../provider/types"

const emptyToolsLayer = Layer.succeed(ToolRegistry, {
  all: () => Effect.succeed([]),
  get: () => Effect.succeed(undefined),
  register: () => Effect.void,
})

function runtime(stream: ReadableStream<any> | (() => ReadableStream<any>), input?: { tools?: Def[]; onRequest?: (req: CompletionRequest) => void }) {
  const providerLayer = Layer.succeed(Provider, {
    complete: () => Effect.die("not implemented"),
    stream: (req) => Effect.sync(() => {
      input?.onRequest?.(req)
      return typeof stream === "function" ? stream() : stream
    }),
    models: () => Effect.succeed([]),
  })
  const toolLayer = input?.tools
    ? Layer.succeed(ToolRegistry, {
        all: () => Effect.succeed(input.tools!),
        get: (id: string) => Effect.succeed(input.tools!.find((tool) => tool.id === id)),
        register: () => Effect.void,
      })
    : emptyToolsLayer
  const layer = Layer.merge(providerLayer, toolLayer)

  return {
    runSync: <E, A>(effect: Effect.Effect<A, E, Provider | ToolRegistry>) => Effect.runPromise(effect.pipe(Effect.provide(layer))),
    systemPrompt: () => "system prompt",
    parseJson: (raw: string) => JSON.parse(raw),
    ask: () => Promise.resolve(),
  }
}

function testTool(id: string): Def {
  return new Def({
    id,
    description: `${id} test tool`,
    parameters: Schema.Struct({}),
    execute: () => Effect.succeed(new Result({ title: id, output: "ok" })),
  })
}

function testToolWithOutput(id: string, output: string): Def {
  return new Def({
    id,
    description: `${id} test tool`,
    parameters: Schema.Struct({}),
    execute: () => Effect.succeed(new Result({ title: id, output })),
  })
}

function createUi(overrides: Partial<Parameters<typeof runSession>[2]> = {}): Parameters<typeof runSession>[2] {
  const abort = new AbortController()
  return {
    abort: abort.signal,
    streamReasoningChunk: () => {},
    streamAssistantChunk: () => {},
    streamToolCallChunk: () => {},
    setStreamingToolResult: () => {},
    addMessage: () => {},
    notify: () => {},
    setStatus: () => {},
    scrollBottom: () => {},
    model: "test-model",
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
    ...overrides,
  }
}

test("streamSession surfaces non-abort provider stream read errors", async () => {
  const stream = new ReadableStream({
    pull(controller) {
      controller.error(new Error("upstream connection reset"))
    },
  })

  const gen = streamSession("hello", [], {
    abort: new AbortController().signal,
    model: "test-model",
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
  }, runtime(stream))

  await gen.next() // user message
  await gen.next() // thinking status
  await assert.rejects(() => gen.next(), /upstream connection reset/)
})

test("runSession persists an assistant error message when provider stream reading fails", async () => {
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue({ delta: { content: "partial" } })
      controller.error(new Error("upstream connection reset"))
    },
  })
  const messages: Message[] = []
  const notices: string[] = []
  const statuses: string[] = []

  const result = await runSession("hello", [], createUi({
    addMessage: (message) => messages.push(message),
    notify: (text, kind) => notices.push(`${kind}:${text}`),
    setStatus: (text) => statuses.push(text),
  }), runtime(stream))

  assert.equal(messages.at(-1)?.role, "assistant")
  assert.match(String(messages.at(-1)?.content), /upstream connection reset/)
  assert.equal(result.at(-1)?.role, "assistant")
  assert.match(String(result.at(-1)?.content), /upstream connection reset/)
  assert.deepEqual(notices, ["error:Provider error: upstream connection reset"])
  assert.ok(statuses.includes("error"))
})

test("runSession persists an assistant error message when provider returns an empty response", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ delta: {}, finish_reason: "stop" })
      controller.close()
    },
  })
  const messages: Message[] = []
  const notices: string[] = []
  const statuses: string[] = []

  const result = await runSession("hello", [], createUi({
    addMessage: (message) => messages.push(message),
    notify: (text, kind) => notices.push(`${kind}:${text}`),
    setStatus: (text) => statuses.push(text),
  }), runtime(stream))

  assert.equal(messages.at(-1)?.role, "assistant")
  assert.match(String(messages.at(-1)?.content), /Provider returned an empty assistant response/)
  assert.equal(result.at(-1)?.role, "assistant")
  assert.match(String(result.at(-1)?.content), /Provider returned an empty assistant response/)
  assert.deepEqual(notices, ["error:Provider returned an empty assistant response"])
  assert.ok(statuses.includes("error"))
})

test("streamSession treats empty stop after tool results as clean completion", async () => {
  let requestCount = 0
  const makeStream = () => new ReadableStream({
    start(controller) {
      requestCount++
      if (requestCount === 1) {
        controller.enqueue({
          delta: {},
          tool_calls: [{
            index: 0,
            id: "call_1",
            function: { name: "read", arguments: "{}" },
          }],
        })
      } else {
        controller.enqueue({ delta: {}, finish_reason: "stop" })
      }
      controller.close()
    },
  })

  const gen = streamSession("hello", [], {
    abort: new AbortController().signal,
    model: "test-model",
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
  }, runtime(makeStream, { tools: [testTool("read")] }))

  const chunks: any[] = []
  let done: IteratorResult<any, Message[]>
  do {
    done = await gen.next()
    if (!done.done) chunks.push(done.value)
  } while (!done.done)

  assert.equal(requestCount, 2)
  assert.equal(chunks.some((chunk) => chunk.type === "error"), false)
  assert.equal(chunks.some((chunk) => chunk.type === "notice" && chunk.kind === "error"), false)
  assert.equal(chunks.at(-1)?.type, "done")
  assert.deepEqual(
    done.value.map((message) => message.role),
    ["user", "assistant", "tool"],
  )
})

test("streamSession treats empty EOF after tool results as clean completion", async () => {
  let requestCount = 0
  const makeStream = () => new ReadableStream({
    start(controller) {
      requestCount++
      if (requestCount === 1) {
        controller.enqueue({
          delta: {},
          tool_calls: [{
            index: 0,
            id: "call_1",
            function: { name: "read", arguments: "{}" },
          }],
        })
      }
      controller.close()
    },
  })

  const gen = streamSession("hello", [], {
    abort: new AbortController().signal,
    model: "test-model",
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
  }, runtime(makeStream, { tools: [testTool("read")] }))

  const chunks: any[] = []
  let done: IteratorResult<any, Message[]>
  do {
    done = await gen.next()
    if (!done.done) chunks.push(done.value)
  } while (!done.done)

  assert.equal(requestCount, 2)
  assert.equal(chunks.some((chunk) => chunk.type === "error"), false)
  assert.equal(chunks.some((chunk) => chunk.type === "notice" && chunk.kind === "error"), false)
  assert.equal(chunks.at(-1)?.type, "done")
  assert.deepEqual(
    done.value.map((message) => message.role),
    ["user", "assistant", "tool"],
  )
})

test("streamSession compacts large current-turn tool history before provider requests", async () => {
  let requestCount = 0
  const requests: CompletionRequest[] = []
  const makeStream = () => new ReadableStream({
    start(controller) {
      requestCount++
      if (requestCount <= 5) {
        controller.enqueue({
          delta: {},
          tool_calls: [{
            index: 0,
            id: `call_${requestCount}`,
            function: { name: "read", arguments: "{}" },
          }],
        })
      } else {
        controller.enqueue({ delta: { content: "done" }, finish_reason: "stop" })
      }
      controller.close()
    },
  })

  const gen = streamSession("hello", [], {
    abort: new AbortController().signal,
    model: "test-model",
    modelInfo: { id: "test-model", contextLimit: 4_000 },
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
  }, runtime(makeStream, {
    tools: [testToolWithOutput("read", "x".repeat(12_000))],
    onRequest: (req) => requests.push(req),
  }))

  while (!(await gen.next()).done) {}

  const compactedRequest = requests.find((req) =>
    req.messages.some((message) =>
      message.role === "system"
      && typeof message.content === "string"
      && message.content.includes("[Current Turn Compacted]"),
    ),
  )

  assert.ok(compactedRequest, "expected at least one provider request to compact current-turn tool history")
  assert.ok((compactedRequest?.messages.length ?? 0) < 14)
})

test("streamSession emits structured step-limit notice without misleading final thinking status", async () => {
  const previousMaxSteps = process.env.OPENZEROCODE_MAX_STEPS
  process.env.OPENZEROCODE_MAX_STEPS = "1"
  try {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          delta: {},
          tool_calls: [{
            index: 0,
            id: "call_1",
            function: { name: "missing_tool", arguments: "{}" },
          }],
        })
        controller.close()
      },
    })

    const gen = streamSession("hello", [], {
      abort: new AbortController().signal,
      model: "test-model",
      provider: "test-provider",
      keyName: "test-key",
      mode: "build",
    }, runtime(stream))

    const chunks: any[] = []
    while (true) {
      const next = await gen.next()
      if (next.done) break
      chunks.push(next.value)
    }

    const stepLimitNotice = chunks.find((chunk) => chunk.type === "notice" && chunk.code === "step_limit_reached")
    assert.equal(stepLimitNotice?.kind, "error")
    assert.match(stepLimitNotice?.text, /Stopped after 1 steps/)
    assert.deepEqual(
      chunks.filter((chunk) => chunk.type === "status").map((chunk) => chunk.text),
      ["thinking (step 1/1)...", "preparing tool: missing_tool"],
    )
  } finally {
    if (previousMaxSteps === undefined) delete process.env.OPENZEROCODE_MAX_STEPS
    else process.env.OPENZEROCODE_MAX_STEPS = previousMaxSteps
  }
})

test("streamSession treats abort-time stream cancellation as interruption", async () => {
  const abort = new AbortController()
  const stream = new ReadableStream({
    pull() {
      abort.abort()
      return new Promise(() => {})
    },
  })

  const gen = streamSession("hello", [], {
    abort: abort.signal,
    model: "test-model",
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
  }, runtime(stream))

  await gen.next() // user message
  await gen.next() // thinking status
  const pending = gen.next()
  abort.abort()
  const result = await pending
  assert.equal(result.done, true)
})

test("streamSession exposes all tools in build mode", async () => {
  const requests: CompletionRequest[] = []
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ delta: { content: "done" }, finish_reason: "stop" })
      controller.close()
    },
  })

  const gen = streamSession("capture tools", [], {
    abort: new AbortController().signal,
    model: "test-model",
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
  }, runtime(stream, {
    tools: [
      testTool("read"),
      testTool("grep"),
      testTool("glob"),
      testTool("write"),
      testTool("bash"),
      testTool("web_fetch"),
    ],
    onRequest: (req) => requests.push(req),
  }))

  while (!(await gen.next()).done) {}

  assert.deepEqual(
    requests[0]?.tools?.map((tool) => tool.function.name),
    ["read", "grep", "glob", "write", "bash", "web_fetch"],
  )
})

test("streamSession exposes only read-only inspection tools in plan mode", async () => {
  const requests: CompletionRequest[] = []
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ delta: { content: "plan" }, finish_reason: "stop" })
      controller.close()
    },
  })

  const gen = streamSession("capture tools", [], {
    abort: new AbortController().signal,
    model: "test-model",
    provider: "test-provider",
    keyName: "test-key",
    mode: "plan",
  }, runtime(stream, {
    tools: [
      testTool("read"),
      testTool("grep"),
      testTool("glob"),
      testTool("web_fetch"),
      testTool("analyze_image"),
      testTool("write"),
      testTool("bash"),
      testTool("todowrite"),
    ],
    onRequest: (req) => requests.push(req),
  }))

  while (!(await gen.next()).done) {}

  assert.deepEqual(
    requests[0]?.tools?.map((tool) => tool.function.name),
    ["read", "grep", "glob", "web_fetch", "analyze_image"],
  )
})
