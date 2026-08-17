import { test } from "node:test"
import assert from "node:assert/strict"
import { Effect, Layer, Schema } from "effect"
import { createRecentContextAnchor, runSession, streamSession } from "./session-runner"
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

test("createRecentContextAnchor summarizes recent non-system messages", () => {
  const anchor = createRecentContextAnchor([
    { role: "system", content: "old system note" },
    { role: "user", content: "please inspect the failing test" },
    { role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "read", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "call_1", content: "line 1\nline 2", parts: [{ type: "tool-result", id: "call_1", tool: "read", output: "line 1\nline 2" }] },
    { role: "assistant", content: "The issue is in session-runner." },
  ])

  assert.ok(anchor)
  assert.equal(anchor.role, "system")
  const content = String(anchor.content)
  assert.match(content, /\[Recent Context Anchor\]/)
  assert.match(content, /user: please inspect the failing test/)
  assert.match(content, /assistant: requested tool read/)
  assert.match(content, /tool \(read\): line 1 line 2/)
  assert.match(content, /assistant: The issue is in session-runner\./)
  assert.doesNotMatch(content, /old system note/)
})

test("streamSession does not duplicate fully retained history in a recent context anchor", async () => {
  const requests: CompletionRequest[] = []
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ delta: { content: "ok" }, finish_reason: "stop" })
      controller.close()
    },
  })
  const history: Message[] = [
    { role: "user", content: "previous task" },
    { role: "assistant", content: "previous answer" },
  ]

  const gen = streamSession("new request", history, {
    abort: new AbortController().signal,
    model: "test-model",
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
  }, runtime(stream, { onRequest: (req) => requests.push({ ...req, messages: [...req.messages] }) }))

  let done: IteratorResult<any, Message[]>
  do {
    done = await gen.next()
  } while (!done.done)

  const anchorMessages = requests[0]!.messages.filter((message) =>
    message.role === "system"
    && typeof message.content === "string"
    && message.content.includes("[Recent Context Anchor]"),
  )
  assert.equal(anchorMessages.length, 0)
  assert.equal(requests[0]!.messages.filter((message) => message.content === "previous task").length, 1)
  assert.deepEqual(done.value.map((message) => message.role), ["user", "assistant", "user", "assistant"])
  assert.equal(done.value.some((message) => String(message.content ?? "").includes("[Recent Context Anchor]")), false)
})

test("streamSession anchors only history omitted by context budgeting", async () => {
  const requests: CompletionRequest[] = []
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ delta: { content: "ok" }, finish_reason: "stop" })
      controller.close()
    },
  })
  const history: Message[] = [
    { role: "user", content: `old marker ${"x".repeat(10_000)}` },
    { role: "assistant", content: `old answer ${"y".repeat(10_000)}` },
    { role: "user", content: "recent request" },
    { role: "assistant", content: "recent answer" },
  ]

  const gen = streamSession("new request", history, {
    abort: new AbortController().signal,
    model: "test-model",
    modelInfo: { id: "test-model", contextLimit: 4_000 },
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
  }, runtime(stream, { onRequest: (req) => requests.push(req) }))

  while (!(await gen.next()).done) {}

  const anchor = requests[0]!.messages.find((message) => String(message.content ?? "").includes("[Recent Context Anchor]"))
  assert.ok(anchor)
  assert.match(String(anchor.content), /old marker/)
  assert.doesNotMatch(String(anchor.content), /recent request/)
  assert.equal(requests[0]!.messages.some((message) =>
    message.role !== "system" && String(message.content ?? "").includes("old marker")
  ), false)
})

test("streamSession can disable recent context anchors per request", async () => {
  const requests: CompletionRequest[] = []
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ delta: { content: "ok" }, finish_reason: "stop" })
      controller.close()
    },
  })

  const gen = streamSession("new request", [{ role: "user", content: "previous task" }], {
    abort: new AbortController().signal,
    model: "test-model",
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
    recentContextAnchor: false,
  }, runtime(stream, { onRequest: (req) => requests.push(req) }))

  while (!(await gen.next()).done) {}

  assert.equal(requests[0]!.messages.some((message) => String(message.content ?? "").includes("[Recent Context Anchor]")), false)
})

test("streamSession forwards reasoning effort for Codex GPT-5.5 and GPT-5.6", async () => {
  for (const model of ["openaicodex/gpt-5.5", "openaicodex/gpt-5.6-terra"]) {
    const requests: CompletionRequest[] = []
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ delta: { content: "ok" }, finish_reason: "stop" })
        controller.close()
      },
    })
    const gen = streamSession("hello", [], {
      abort: new AbortController().signal,
      model,
      provider: "zero-api",
      keyName: "test-key",
      mode: "build",
      reasoning_effort: "high",
    }, runtime(stream, { onRequest: (req) => requests.push(req) }))

    while (!(await gen.next()).done) {}

    assert.equal(requests[0]?.reasoning_effort, "high", model)
  }
})

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

test("streamSession retries a Codex stream interrupted before any output", async () => {
  let requestCount = 0
  const makeStream = () => new ReadableStream({
    pull(controller) {
      requestCount++
      if (requestCount === 1) controller.error(new Error("upstream connection reset"))
      else {
        controller.enqueue({ delta: { content: "recovered" }, finish_reason: "stop" })
        controller.close()
      }
    },
  })

  const gen = streamSession("hello", [], {
    abort: new AbortController().signal,
    model: "gpt-5.5-codex",
    provider: "openai-codex",
    keyName: "test-key",
    mode: "build",
  }, runtime(makeStream))

  const chunks: any[] = []
  let result: Message[] = []
  while (true) {
    const next = await gen.next()
    if (next.done) {
      result = next.value
      break
    }
    chunks.push(next.value)
  }

  assert.equal(requestCount, 2)
  assert.equal(result.at(-1)?.content, "recovered")
  assert.ok(chunks.some((chunk) => chunk.type === "notice" && /before output; retrying/.test(chunk.text)))
})

test("streamSession retries a transient zero-api fetch failure before a stream is returned", async () => {
  let requestCount = 0
  const makeStream = () => {
    requestCount++
    if (requestCount === 1) throw new TypeError("fetch failed: ECONNRESET")
    return new ReadableStream({
      start(controller) {
        controller.enqueue({ delta: { content: "recovered" }, finish_reason: "stop" })
        controller.close()
      },
    })
  }

  const gen = streamSession("hello", [], {
    abort: new AbortController().signal,
    model: "test-model",
    provider: "zero-api",
    keyName: "test-key",
    mode: "build",
  }, runtime(makeStream))

  const notices: string[] = []
  let result: Message[] = []
  while (true) {
    const next = await gen.next()
    if (next.done) {
      result = next.value
      break
    }
    if (next.value.type === "notice") notices.push(next.value.text)
  }

  assert.equal(requestCount, 2)
  assert.equal(result.at(-1)?.content, "recovered")
  assert.ok(notices.some((text) => /retrying \(1\/3\)/.test(text)))
})

test("streamSession saves partial Codex text and continues after interruption", async () => {
  let requestCount = 0
  const requests: CompletionRequest[] = []
  const makeStream = () => {
    requestCount++
    let pulls = 0
    return new ReadableStream({
      pull(controller) {
        pulls++
        if (requestCount === 1) {
          if (pulls === 1) controller.enqueue({ delta: { content: "partial " } })
          else controller.error(new Error("connection closed"))
        } else if (pulls === 1) {
          controller.enqueue({ delta: { content: "par" } })
        } else {
          controller.enqueue({ delta: { content: "tial answer" }, finish_reason: "stop" })
          controller.close()
        }
      },
    })
  }

  const gen = streamSession("hello", [], {
    abort: new AbortController().signal,
    model: "gpt-5.5-codex",
    provider: "openai-codex",
    keyName: "test-key",
    mode: "build",
  }, runtime(makeStream, { onRequest: (req) => requests.push(req) }))

  let result: Message[] = []
  while (true) {
    const next = await gen.next()
    if (next.done) {
      result = next.value
      break
    }
  }

  assert.equal(requestCount, 2)
  assert.deepEqual(
    result.filter((message) => message.role === "assistant").map((message) => message.content),
    ["partial ", "answer"],
  )
  assert.ok(requests[1]?.messages.some((message) => message.role === "assistant" && message.content === "partial "))
  assert.ok(requests[1]?.messages.some((message) => message.role === "user" && String(message.content).includes("provider stream was interrupted")))
})

test("streamSession does not retry an interrupted Codex tool call", async () => {
  let requestCount = 0
  const makeStream = () => {
    requestCount++
    let pulls = 0
    return new ReadableStream({
      pull(controller) {
        pulls++
        if (pulls === 1) {
          controller.enqueue({
            delta: {},
            tool_calls: [{ index: 0, id: "call_1", function: { name: "write", arguments: "{\"filePath\":" } }],
          })
        } else {
          controller.error(new Error("connection closed"))
        }
      },
    })
  }

  const gen = streamSession("hello", [], {
    abort: new AbortController().signal,
    model: "gpt-5.5-codex",
    provider: "openai-codex",
    keyName: "test-key",
    mode: "build",
  }, runtime(makeStream, { tools: [testTool("write")] }))

  await assert.rejects(async () => {
    while (!(await gen.next()).done) {}
  }, /connection closed/)
  assert.equal(requestCount, 1)
})

test("streamSession does not replay after a completed tool side-effect boundary", async () => {
  let requestCount = 0
  const makeStream = () => {
    requestCount++
    if (requestCount === 1) {
      return new ReadableStream({
        start(controller) {
          controller.enqueue({
            delta: {},
            tool_calls: [{ index: 0, id: "call_1", function: { name: "write", arguments: "{}" } }],
            finish_reason: "tool_calls",
          })
          controller.close()
        },
      })
    }
    throw new TypeError("fetch failed: ECONNRESET")
  }

  const gen = streamSession("hello", [], {
    abort: new AbortController().signal,
    model: "test-model",
    provider: "zero-api",
    keyName: "test-key",
    mode: "build",
  }, runtime(makeStream, { tools: [testTool("write")] }))

  let result: Message[] = []
  while (true) {
    const next = await gen.next()
    if (next.done) {
      result = next.value
      break
    }
  }

  assert.equal(requestCount, 2)
  assert.equal(result.filter((message) => message.role === "tool").length, 1)
  assert.match(String(result.at(-1)?.content), /Network error/)
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

test("runSession reports an error when the provider returns reasoning without an answer", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ delta: { reasoning_content: "I should inspect the project first." } })
      controller.enqueue({ delta: {}, finish_reason: "stop" })
      controller.close()
    },
  })
  const messages: Message[] = []
  const reasoning: string[] = []
  const notices: string[] = []

  const result = await runSession("hello", [], createUi({
    addMessage: (message) => messages.push(message),
    streamReasoningChunk: (content) => reasoning.push(content),
    notify: (text, kind) => notices.push(`${kind}:${text}`),
  }), runtime(stream))

  assert.deepEqual(reasoning, ["I should inspect the project first."])
  assert.equal(messages.at(-1)?.role, "assistant")
  assert.match(String(messages.at(-1)?.content), /Provider returned reasoning without an assistant response/)
  assert.equal(messages.at(-1)?.reasoning_content, "I should inspect the project first.")
  assert.match(String(result.at(-1)?.content), /Provider returned reasoning without an assistant response/)
  assert.deepEqual(notices, ["error:Provider returned reasoning without an assistant response"])
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

test("streamSession trims initial history against prefix and image request budget", async () => {
  const requests: CompletionRequest[] = []
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ delta: { content: "ok" }, finish_reason: "stop" })
      controller.close()
    },
  })
  const imagePart = { type: "image_url" as const, image_url: { url: `data:image/png;base64,${"a".repeat(20_000)}` } }
  const history: Message[] = [
    { role: "user", content: [{ type: "text", text: "old image 1" }, imagePart] },
    { role: "assistant", content: "old answer 1" },
    { role: "user", content: [{ type: "text", text: "old image 2" }, imagePart] },
    { role: "assistant", content: "old answer 2" },
    { role: "user", content: [{ type: "text", text: "recent image" }, imagePart] },
    { role: "assistant", content: "recent answer" },
  ]

  const gen = streamSession("new request", history, {
    abort: new AbortController().signal,
    model: "test-model",
    modelInfo: { id: "test-model", contextLimit: 5_000 },
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
    recentContextAnchor: false,
  }, runtime(stream, { onRequest: (req) => requests.push({ ...req, messages: [...req.messages] }) }))

  while (!(await gen.next()).done) {}

  assert.equal(requests.length, 1)
  const sentMessages = requests[0]!.messages
  assert.equal(sentMessages[0]?.role, "system")
  assert.equal(sentMessages.at(-1)?.content, "new request")
  assert.equal(sentMessages.filter((message) => Array.isArray(message.content)).length, 1)
  assert.deepEqual(sentMessages.map((message) => message.content), [
    "system prompt",
    "old answer 2",
    [{ type: "text", text: "recent image" }, imagePart],
    "recent answer",
    "new request",
  ])
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

test("streamSession sends only the Lite allowlist to local models", async () => {
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
    harnessProfile: "lite",
  }, runtime(stream, {
    tools: [
      testTool("read"),
      testTool("bash"),
      testTool("web_fetch"),
      testTool("todowrite"),
      testTool("call_peer"),
      testTool("mcp_custom"),
    ],
    onRequest: (req) => requests.push(req),
  }))

  while (!(await gen.next()).done) {}

  assert.deepEqual(requests[0]?.tools?.map((tool) => tool.function.name), ["read", "bash"])
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
