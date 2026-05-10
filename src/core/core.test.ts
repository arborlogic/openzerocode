import { describe, it } from "node:test"
import assert from "node:assert"
import { Effect, Layer } from "effect"
import { Provider } from "../provider/types"
import { bigPickleLayer } from "../provider/index"
import { ToolRegistry, layer as toolLayer } from "../tool/registry"
import { runLoop } from "./run-loop"

const API_KEY = process.env.OPENCODE_API_KEY
if (!API_KEY) throw new Error("OPENCODE_API_KEY env var required")

const testLayer = Layer.merge(
  bigPickleLayer({ apiKey: API_KEY }),
  toolLayer,
)

describe("runLoop", () => {
  it("responds to a simple text query", async () => {
    const history = await Effect.runPromise(
      runLoop(
        "say hello in one word",
        [],
        {
          cwd: process.cwd(),
          root: process.cwd(),
          abort: new AbortController().signal,
          ask: () => Effect.void,
        },
      ).pipe(Effect.provide(testLayer))
    )

    const lastMsg = history[history.length - 1]
    assert.equal(lastMsg.role, "assistant")
    assert.ok(lastMsg.content)
  })

  it("uses tools when needed (bash echo)", async () => {
    const history = await Effect.runPromise(
      runLoop(
        "run: echo hello-tool-test",
        [],
        {
          cwd: process.cwd(),
          root: process.cwd(),
          abort: new AbortController().signal,
          ask: () => Effect.void,
        },
      ).pipe(Effect.provide(testLayer))
    )

    const assistantMsgs = history.filter((m) => m.role === "assistant")
    const toolMsgs = history.filter((m) => m.role === "tool")
    assert.ok(assistantMsgs.length > 0)
  })
})
