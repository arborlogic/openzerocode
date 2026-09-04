import { test } from "node:test"
import assert from "node:assert/strict"
import { Effect, Layer, Schema } from "effect"
import { createRecentContextAnchor, runSession, streamSession, toolErrorFingerprint } from "./session-runner"
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

test("streamSession retries an explicit provider context overflow with less history", async () => {
  const requests: CompletionRequest[] = []
  let calls = 0
  const history: Message[] = [
    { role: "user", content: `old marker ${"x".repeat(80_000)}` },
    { role: "assistant", content: `old answer ${"y".repeat(80_000)}` },
    { role: "user", content: "recent request" },
    { role: "assistant", content: "recent answer" },
  ]
  const providerLayer = Layer.succeed(Provider, {
    complete: () => Effect.die("not implemented"),
    stream: (request) => Effect.sync(() => {
      requests.push({ ...request, messages: [...request.messages] })
      calls++
      if (calls === 1) {
        throw new Error('upstream returned status 400: {"error":{"code":400,"message":"request (35373 tokens) exceeds the available context size (34048 tokens)"}}')
      }
      return new ReadableStream({
        start(controller) {
          controller.enqueue({ delta: { content: "ok" }, finish_reason: "stop" })
          controller.close()
        },
      })
    }),
    models: () => Effect.succeed([]),
  })
  const layer = Layer.merge(providerLayer, emptyToolsLayer)
  const runtimeWithOverflow = {
    ...runtime(new ReadableStream()),
    runSync: <E, A>(effect: Effect.Effect<A, E, Provider | ToolRegistry>) => Effect.runPromise(effect.pipe(Effect.provide(layer))),
  }

  const gen = streamSession("new request", history, {
    abort: new AbortController().signal,
    model: "test-model",
    modelInfo: { id: "test-model", contextLimit: 34_048 },
    provider: "zero-api",
    keyName: "test-key",
    mode: "build",
  }, runtimeWithOverflow)

  while (!(await gen.next()).done) {}

  assert.equal(requests.length, 2)
  assert.ok(requests[1]!.messages.length < requests[0]!.messages.length)
  const retryAnchor = requests[1]!.messages.find((message) =>
    message.role === "system" && String(message.content ?? "").includes("[Recent Context Anchor]"),
  )
  assert.ok(retryAnchor)
  assert.match(String(retryAnchor.content), /old marker/)
  assert.equal(requests[1]!.messages.some((message) =>
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

test("streamSession uses provider context metadata ahead of the static model catalogue", async () => {
  const requests: CompletionRequest[] = []
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ delta: { content: "ok" }, finish_reason: "stop" })
      controller.close()
    },
  })
  const history: Message[] = [
    { role: "user", content: "old marker " + "x".repeat(36_000) },
    { role: "assistant", content: "old answer " + "y".repeat(36_000) },
  ]

  const gen = streamSession("new request", history, {
    abort: new AbortController().signal,
    model: "gpt-5.5",
    modelInfo: { id: "gpt-5.5", contextLimit: 10_000 },
    provider: "zero-api",
    keyName: "test-key",
    mode: "build",
  }, runtime(stream, { onRequest: (req) => requests.push(req) }))

  while (!(await gen.next()).done) {}

  assert.equal(requests[0]?.messages.some((message) =>
    message.role !== "system" && String(message.content ?? "").includes("old marker")
  ), false)
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

test("streamSession normalizes advanced reasoning effort for the selected model", async () => {
  const cases = [
    { model: "openaicodex/gpt-5.6-sol", effort: "max" as const, expected: "max" },
    { model: "openaicodex/gpt-5.5", effort: "max" as const, expected: "high" },
    { model: "deepseek-v4-pro", effort: "xhigh" as const, expected: "high" },
  ]

  for (const { model, effort, expected } of cases) {
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
      reasoning_effort: effort,
    }, runtime(stream, { onRequest: (req) => requests.push(req) }))

    while (!(await gen.next()).done) {}

    assert.equal(requests[0]?.reasoning_effort, expected, model)
  }
})

test("streamSession surfaces non-abort provider stream read errors", async () => {
  const stream = new ReadableStream({
    pull(controller) {
      controller.error(new Error("upstream connection reset"))
    },
  })

  const outcomes: any[] = []
  const onOutcome = (outcome: any) => outcomes.push(outcome)
  const gen = streamSession("hello", [], {
    abort: new AbortController().signal,
    model: "test-model",
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
    onOutcome,
  }, runtime(stream))

  // Drain the generator. Previously this rejected with the provider error;
  // after introducing the RunOutcome contract, non-recoverable provider
  // errors surface as a `provider_error` outcome chunk before the generator
  // re-throws to the runSession() wrapper.
  let caught: unknown
  while (true) {
    try {
      const next = await gen.next()
      if (next.done) break
    } catch (error) {
      caught = error
      break
    }
  }
  assert.ok(caught, "expected the generator to re-throw the provider error so the runSession() wrapper can surface it")
  assert.match(String(caught instanceof Error ? caught.message : caught), /upstream connection reset/)
  const providerError = outcomes.find((outcome) => outcome.kind === "provider_error")
  assert.ok(providerError, "expected a provider_error outcome for a non-recoverable provider stream read failure")
  assert.match(providerError.message, /upstream connection reset/)
})

test("streamSession emits a provider_error outcome when a provider request fails before streaming", async () => {
  const outcomes: any[] = []
  const gen = streamSession("hello", [], {
    abort: new AbortController().signal,
    model: "test-model",
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
    onOutcome: (outcome) => outcomes.push(outcome),
  }, runtime(() => {
    throw new Error("provider is unavailable")
  }))

  const chunks: any[] = []
  while (true) {
    const next = await gen.next()
    if (next.done) break
    chunks.push(next.value)
  }

  assert.deepEqual(outcomes.map((outcome) => outcome.kind), ["provider_error"])
  const outcomeIndex = chunks.findIndex((chunk) => chunk.type === "outcome")
  const errorIndex = chunks.findIndex((chunk) => chunk.type === "error")
  assert.ok(outcomeIndex >= 0, "expected a provider_error outcome chunk")
  assert.ok(errorIndex >= 0, "expected the legacy error chunk")
  assert.ok(outcomeIndex < errorIndex, "expected the outcome before the legacy error chunk")
  assert.match(outcomes[0].message, /provider is unavailable/)
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

test("streamSession retries an interrupted OpenCode Zen stream and keeps session affinity", async () => {
  let requestCount = 0
  const requests: CompletionRequest[] = []
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
    model: "big-pickle",
    provider: "opencode-zen",
    keyName: "anonymous",
    sessionId: "zen-session-1",
    mode: "build",
  }, runtime(makeStream, { onRequest: (request) => requests.push(request) }))

  let result: Message[] = []
  while (true) {
    const next = await gen.next()
    if (next.done) {
      result = next.value
      break
    }
  }

  assert.equal(requestCount, 2)
  assert.equal(result.at(-1)?.content, "recovered")
  assert.equal(requests[0]?.requestHeaders?.["x-opencode-session"], "zen-session-1")
  assert.equal(requests[0]?.requestHeaders?.["x-opencode-session"], requests[1]?.requestHeaders?.["x-opencode-session"])
  assert.equal(requests[0]?.requestHeaders?.["x-opencode-client"], "openzerocode")
})

test("streamSession reduces retained history after an empty interrupted zero-api stream", async () => {
  let requestCount = 0
  const requests: CompletionRequest[] = []
  const legacyFailure: Message = {
    role: "assistant",
    content: "Error: Provider error: provider stream ended before completion",
  }
  const history: Message[] = [
    ...Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `history ${index}: ${"x".repeat(1_500)}`,
    })),
    legacyFailure,
  ]
  const makeStream = () => new ReadableStream({
    pull(controller) {
      requestCount++
      if (requestCount === 1) controller.close()
      else {
        controller.enqueue({ delta: { content: "recovered" }, finish_reason: "stop" })
        controller.close()
      }
    },
  })

  const gen = streamSession("hello", history, {
    abort: new AbortController().signal,
    model: "test-model",
    modelInfo: { id: "test-model", contextLimit: 12_000 },
    provider: "zero-api",
    keyName: "test-key",
    mode: "build",
  }, runtime(makeStream, { onRequest: (request) => requests.push(request) }))

  const notices: string[] = []
  while (true) {
    const next = await gen.next()
    if (next.done) break
    if (next.value.type === "notice") notices.push(next.value.text)
  }

  assert.equal(requests.length, 2)
  assert.ok(requests[1]!.messages.length < requests[0]!.messages.length)
  assert.ok(!requests[0]!.messages.includes(legacyFailure))
  assert.ok(!requests[1]!.messages.includes(legacyFailure))
  assert.ok(notices.some((text) => /reduced session context/.test(text)))
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
  const errors: string[] = []
  while (true) {
    const next = await gen.next()
    if (next.done) {
      result = next.value
      break
    }
    if (next.value.type === "error") errors.push(next.value.message)
  }

  assert.equal(requestCount, 2)
  assert.equal(result.filter((message) => message.role === "tool").length, 1)
  assert.match(String(result.at(-1)?.content), /write\n---\nok/)
  assert.deepEqual(errors, ["Network error while contacting provider. Please retry."])
})

test("runSession reports a provider stream reading failure without persisting it as assistant context", async () => {
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

  assert.deepEqual(messages, [{ role: "user", content: "hello" }])
  assert.deepEqual(result, [{ role: "user", content: "hello" }])
  assert.deepEqual(notices, ["error:Provider error: upstream connection reset"])
  assert.ok(statuses.includes("error"))
})

test("runSession reports an empty provider response without persisting it as assistant context", async () => {
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

  assert.deepEqual(messages, [{ role: "user", content: "hello" }])
  assert.deepEqual(result, [{ role: "user", content: "hello" }])
  assert.deepEqual(notices, ["error:Provider returned an empty assistant response"])
  assert.ok(statuses.includes("error"))
})

test("runSession reports reasoning without an answer without persisting it as assistant context", async () => {
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
  assert.deepEqual(messages, [{ role: "user", content: "hello" }])
  assert.deepEqual(result, [{ role: "user", content: "hello" }])
  assert.deepEqual(notices, ["error:Provider returned reasoning without an assistant response"])
})

test("streamSession excludes legacy persisted provider failures from the next request and saved history", async () => {
  const requests: CompletionRequest[] = []
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ delta: { content: "recovered" }, finish_reason: "stop" })
      controller.close()
    },
  })
  const legacyFailure: Message = {
    role: "assistant",
    content: "Error: Provider error: provider stream ended before completion",
  }

  const gen = streamSession("try again", [
    { role: "user", content: "original request" },
    legacyFailure,
  ], {
    abort: new AbortController().signal,
    model: "test-model",
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
  }, runtime(stream, { onRequest: (request) => requests.push(request) }))

  let done: IteratorResult<any, Message[]>
  do {
    done = await gen.next()
  } while (!done.done)

  assert.equal(requests.length, 1)
  assert.ok(!requests[0]!.messages.includes(legacyFailure))
  assert.ok(!done.value.includes(legacyFailure))
  assert.deepEqual(done.value.map((message) => message.content), ["original request", "try again", "recovered"])
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

test("streamSession applies steering to the active run at the next model boundary", async () => {
  const requests: CompletionRequest[] = []
  let requestCount = 0
  let steering = ["Use the targeted test instead of the full suite."]
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
        controller.enqueue({ delta: { content: "Adjusted." }, finish_reason: "stop" })
      }
      controller.close()
    },
  })

  const gen = streamSession("fix the tests", [], {
    abort: new AbortController().signal,
    model: "test-model",
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
    consumeSteeringMessages: () => steering.splice(0),
  }, runtime(makeStream, {
    tools: [testTool("read")],
    // Providers receive the live message array. Snapshot each request so later
    // loop mutations do not rewrite what the first request contained.
    onRequest: (request) => requests.push({ ...request, messages: request.messages.map((message) => ({ ...message })) }),
  }))

  const chunks: any[] = []
  let done: IteratorResult<any, Message[]>
  do {
    done = await gen.next()
    if (!done.done) chunks.push(done.value)
  } while (!done.done)

  assert.equal(requestCount, 2)
  assert.equal(requests[0]!.messages.some((message) => String(message.content).includes("Steering instruction")), false)
  assert.equal(requests[1]!.messages.some((message) => String(message.content).includes("Use the targeted test")), true)
  assert.equal(chunks.some((chunk) => chunk.type === "notice" && chunk.text.includes("Steering applied")), true)
  assert.equal(done.value.some((message) => message.role === "user" && String(message.content).includes("Use the targeted test")), true)
})

test("streamSession closes steering before a final assistant step and does not drain late guidance", async () => {
  const steering = ["This must not leak into another run."]
  const availability: boolean[] = []
  let consumeCount = 0
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ delta: { content: "Finished." }, finish_reason: "stop" })
      controller.close()
    },
  })

  const gen = streamSession("finish now", [], {
    abort: new AbortController().signal,
    model: "test-model",
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
    maxSteps: 1,
    consumeSteeringMessages: () => {
      consumeCount++
      return steering.splice(0)
    },
    setSteeringAvailable: (available) => availability.push(available),
  }, runtime(stream))

  let done: IteratorResult<any, Message[]>
  do {
    done = await gen.next()
  } while (!done.done)

  assert.deepEqual(availability, [false])
  assert.equal(consumeCount, 0)
  assert.deepEqual(steering, ["This must not leak into another run."])
  assert.equal(done.value.some((message) => String(message.content).includes("must not leak")), false)
})

test("streamSession closes steering before tools execute on the final permitted step", async () => {
  const steering = ["Too late for this run."]
  const availability: boolean[] = []
  let consumeCount = 0
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({
        delta: {},
        tool_calls: [{
          index: 0,
          id: "call_1",
          function: { name: "read", arguments: "{}" },
        }],
      })
      controller.close()
    },
  })

  const gen = streamSession("read once", [], {
    abort: new AbortController().signal,
    model: "test-model",
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
    maxSteps: 1,
    consumeSteeringMessages: () => {
      consumeCount++
      return steering.splice(0)
    },
    setSteeringAvailable: (available) => availability.push(available),
  }, runtime(stream, { tools: [testTool("read")] }))

  const chunks: any[] = []
  while (true) {
    const next = await gen.next()
    if (next.done) break
    chunks.push(next.value)
  }

  assert.deepEqual(availability, [false])
  assert.equal(consumeCount, 0)
  assert.deepEqual(steering, ["Too late for this run."])
  assert.equal(chunks.some((chunk) => chunk.type === "notice" && chunk.code === "step_limit_reached"), true)
  assert.equal(chunks.some((chunk) => String(chunk.message?.content).includes("Too late")), false)
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

  const outcomes: any[] = []
  const onOutcome = (outcome: any) => outcomes.push(outcome)
  const gen = streamSession("hello", [], {
    abort: abort.signal,
    model: "test-model",
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
    onOutcome,
  }, runtime(stream))

  await gen.next() // user message
  await gen.next() // thinking status
  abort.abort()
  // Drain the rest. Aborts now surface as an `aborted` outcome chunk before
  // the generator returns, instead of closing immediately on the abort path.
  while (true) {
    const next = await gen.next()
    if (next.done) break
  }
  const aborted = outcomes.find((outcome) => outcome.kind === "aborted")
  assert.ok(aborted, "expected an aborted outcome for an interrupt-time cancellation")
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

test("streamSession emits a step_limit_reached outcome before the matching notice", async () => {
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

    const outcomes: any[] = []
    const onOutcome = (outcome: any) => outcomes.push(outcome)
    const gen = streamSession("hello", [], {
      abort: new AbortController().signal,
      model: "test-model",
      provider: "test-provider",
      keyName: "test-key",
      mode: "build",
      onOutcome,
    }, runtime(stream))

    const chunks: any[] = []
    while (true) {
      const next = await gen.next()
      if (next.done) break
      chunks.push(next.value)
    }

    assert.equal(outcomes.length, 1)
    assert.equal(outcomes[0].kind, "step_limit_reached")
    assert.equal(outcomes[0].maxSteps, 1)

    // The outcome chunk should be yielded before the matching notice so a
    // supervisor reading the stream can react before the human sees the toast.
    const outcomeIndex = chunks.findIndex((chunk) => chunk.type === "outcome")
    const noticeIndex = chunks.findIndex((chunk) => chunk.type === "notice" && chunk.code === "step_limit_reached")
    assert.ok(outcomeIndex >= 0, "expected an outcome chunk")
    assert.ok(noticeIndex >= 0, "expected a step_limit_reached notice chunk")
    assert.ok(outcomeIndex < noticeIndex, "expected the outcome chunk to precede the notice chunk")
  } finally {
    if (previousMaxSteps === undefined) delete process.env.OPENZEROCODE_MAX_STEPS
    else process.env.OPENZEROCODE_MAX_STEPS = previousMaxSteps
  }
})

test("streamSession emits a completed outcome at the end of a normal turn", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue({ delta: { content: "all done" }, finish_reason: "stop" })
      controller.close()
    },
  })

  const outcomes: any[] = []
  const onOutcome = (outcome: any) => outcomes.push(outcome)
  const gen = streamSession("hello", [], {
    abort: new AbortController().signal,
    model: "test-model",
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
    onOutcome,
  }, runtime(stream))

  while (true) {
    const next = await gen.next()
    if (next.done) break
  }

  assert.equal(outcomes.length, 1)
  assert.equal(outcomes[0].kind, "completed")
})

test("streamSession emits a replan_needed outcome when a single tool error fires three times", async () => {
  const previousMaxSteps = process.env.OPENZEROCODE_MAX_STEPS
  process.env.OPENZEROCODE_MAX_STEPS = "10"
  try {
    // Each step the model asks for "bash" with the same input, so the same
    // tool-error fingerprint accumulates 3 times across steps 0..2. The run
    // must terminate immediately rather than spending its remaining 7 steps.
    let stepIndex = 0
    const makeStream = () => new ReadableStream({
      start(controller) {
        stepIndex++
        controller.enqueue({
          delta: {},
          tool_calls: [{
            index: 0,
            id: `call_${stepIndex}`,
            function: { name: "bash", arguments: JSON.stringify({ cmd: "false" }) },
          }],
        })
        controller.close()
      },
    })

    const failingBash = new Def({
      id: "bash",
      description: "always fails the same way",
      parameters: Schema.Struct({}),
      execute: () => Effect.succeed(new Result({
        title: "Error",
        output: "command exited with code 1: missing libfoo.so",
      })),
    })

    const outcomes: any[] = []
    const onOutcome = (outcome: any) => outcomes.push(outcome)
    const gen = streamSession("hello", [], {
      abort: new AbortController().signal,
      model: "test-model",
      provider: "test-provider",
      keyName: "test-key",
      mode: "build",
      onOutcome,
    }, runtime(makeStream, { tools: [failingBash] }))

    while (true) {
      const next = await gen.next()
      if (next.done) break
    }

    const replan = outcomes.find((outcome) => outcome.kind === "replan_needed")
    assert.ok(replan, "expected a replan_needed outcome after the same tool error fired 3 times")
    assert.match(replan.reason, /bash failed with the same error 3 times/)
    assert.equal(replan.recentErrors[0]?.tool, "bash")
    assert.match(replan.recentErrors[0]?.signature ?? "", /bash::/)
    assert.equal(stepIndex, 3, "expected the third matching failure to terminate the run immediately")
    assert.deepEqual(outcomes.map((outcome) => outcome.kind), ["replan_needed"])
  } finally {
    if (previousMaxSteps === undefined) delete process.env.OPENZEROCODE_MAX_STEPS
    else process.env.OPENZEROCODE_MAX_STEPS = previousMaxSteps
  }
})

test("streamSession emits one internal_error outcome before rethrowing unexpected runtime failures", async () => {
  const outcomes: any[] = []
  const chunks: any[] = []
  const baseRuntime = runtime(new ReadableStream())
  const gen = streamSession("hello", [], {
    abort: new AbortController().signal,
    model: "test-model",
    provider: "test-provider",
    keyName: "test-key",
    mode: "build",
    onOutcome: (outcome) => outcomes.push(outcome),
  }, {
    ...baseRuntime,
    systemPrompt: () => { throw new Error("system prompt exploded") },
  })

  let caught: unknown
  while (true) {
    try {
      const next = await gen.next()
      if (next.done) break
      chunks.push(next.value)
    } catch (error) {
      caught = error
      break
    }
  }

  assert.match(caught instanceof Error ? caught.message : String(caught), /system prompt exploded/)
  assert.deepEqual(outcomes, [{ kind: "internal_error", message: "system prompt exploded" }])
  assert.deepEqual(
    chunks.filter((chunk) => chunk.type === "outcome").map((chunk) => chunk.outcome.kind),
    ["internal_error"],
  )
})

test("streamSession does NOT emit replan_needed when a tool error fingerprint only fires twice", async () => {
  const previousMaxSteps = process.env.OPENZEROCODE_MAX_STEPS
  process.env.OPENZEROCODE_MAX_STEPS = "2"
  try {
    let stepIndex = 0
    const makeStream = () => new ReadableStream({
      start(controller) {
        stepIndex++
        controller.enqueue({
          delta: {},
          tool_calls: [{
            index: 0,
            id: `call_${stepIndex}`,
            function: { name: "bash", arguments: JSON.stringify({ cmd: "false" }) },
          }],
        })
        controller.close()
      },
    })
    const failingBash = new Def({
      id: "bash",
      description: "always fails the same way",
      parameters: Schema.Struct({}),
      execute: () => Effect.succeed(new Result({
        title: "Error",
        output: "command exited with code 1: missing libfoo.so",
      })),
    })

    const outcomes: any[] = []
    const onOutcome = (outcome: any) => outcomes.push(outcome)
    const gen = streamSession("hello", [], {
      abort: new AbortController().signal,
      model: "test-model",
      provider: "test-provider",
      keyName: "test-key",
      mode: "build",
      onOutcome,
    }, runtime(makeStream, { tools: [failingBash] }))

    while (true) {
      const next = await gen.next()
      if (next.done) break
    }

    assert.equal(outcomes.some((outcome) => outcome.kind === "replan_needed"), false)
    // The run did hit the cap, so it should still emit a step_limit_reached
    // outcome — the test is about replan_needed specifically, not about
    // suppressing the normal step-limit signal.
    const stepLimit = outcomes.find((outcome) => outcome.kind === "step_limit_reached")
    assert.ok(stepLimit, "expected a step_limit_reached outcome for a cap-bound run")
  } finally {
    if (previousMaxSteps === undefined) delete process.env.OPENZEROCODE_MAX_STEPS
    else process.env.OPENZEROCODE_MAX_STEPS = previousMaxSteps
  }
})

test("toolErrorFingerprint normalises hex addresses and digits so minor wording changes don't reset the count", () => {
  // Two exit codes of the same kind share a fingerprint, so the count isn't
  // reset every time the kernel picks a different exit value.
  const a = toolErrorFingerprint("bash", "command exited with code 1: missing libfoo.so")
  const b = toolErrorFingerprint("bash", "command exited with code 2: missing libfoo.so")
  assert.equal(a, b, "expected different exit codes to share a fingerprint")

  // Hex addresses and decimal counts are interchangeable for fingerprinting
  // purposes; only the shape of the message matters.
  const c = toolErrorFingerprint("bash", "alloc failed at 0xdeadbeef: 5 retries left")
  const d = toolErrorFingerprint("bash", "alloc failed at 0xcafef00d: 9 retries left")
  assert.equal(c, d, "expected hex addresses and decimal counts to be normalised in the fingerprint")
  assert.match(c, /^bash::/)
})
