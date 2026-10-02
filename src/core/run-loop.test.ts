import assert from "node:assert/strict"
import { it } from "node:test"
import { Effect, Schema } from "effect"
import { Provider } from "../provider/types"
import { ToolRegistry } from "../tool/registry"
import { Def, Result } from "../tool/types"
import { runLoop } from "./run-loop"

for (const raw of ["{}", '{"command":']) {
  it(`runLoop rejects invalid tool arguments ${raw} before permission or execution`, async () => {
    let permissions = 0
    let executions = 0
    const bash = new Def({
      id: "bash",
      description: "test bash",
      parameters: Schema.Struct({ command: Schema.String }),
      execute: () => {
        executions++
        return Effect.succeed(new Result({ title: "Bash", output: "unexpected" }))
      },
    })
    const history = await Effect.runPromise(runLoop("hello", [], {
      model: "test",
      cwd: process.cwd(),
      root: process.cwd(),
      maxSteps: 1,
      abort: new AbortController().signal,
      ask: () => Effect.sync(() => { permissions++ }),
    }).pipe(
      Effect.provideService(ToolRegistry, {
        all: () => Effect.succeed([bash]),
        get: () => Effect.succeed(bash),
        register: () => Effect.void,
      }),
      Effect.provideService(Provider, {
        complete: () => Effect.succeed({
          id: "test",
          model: "test",
          message: {
            role: "assistant",
            tool_calls: [{ id: "call", type: "function", function: { name: "bash", arguments: raw } }],
          },
          finish_reason: "tool_calls",
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        }),
        stream: () => Effect.succeed(new ReadableStream()),
        models: () => Effect.succeed([]),
      }),
    ))
    assert.equal(permissions, 0)
    assert.equal(executions, 0)
    const message = history.find((message) => message.role === "tool")
    assert.ok(message)
    assert.match(String(message.content), /Invalid arguments for tool "bash"/)
    assert.ok(message.parts?.some((part) => part.type === "tool-result" && part.error === true))
  })
}
