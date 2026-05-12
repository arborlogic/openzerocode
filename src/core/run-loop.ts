import { Effect } from "effect"
import { Def, Context, Result } from "../tool/tool"
import { ToolRegistry } from "../tool/registry"
import { Provider, type Message, type ToolCall, type CompletionResult } from "../provider/types"
import { createAssistantMessage, createToolMessage } from "../provider/message-parts"
import { convertToolsToDefs, convertToolResult } from "./convert"

export type LoopConfig = {
  systemPrompt?: string
  maxSteps?: number
  cwd: string
  root: string
  abort: AbortSignal
  ask: (input: { permission: string; patterns: string[] }) => Effect.Effect<void>
}

export function runLoop(
  userInput: string,
  messages: Message[],
  config: LoopConfig,
): Effect.Effect<Message[], never, ToolRegistry | Provider> {
  const maxSteps = config.maxSteps ?? 50

  const systemMessage: Message = {
    role: "system",
    content: config.systemPrompt ?? [
      "You are a helpful coding assistant.",
      "Use the available tools to help the user.",
      `Working directory: ${config.cwd}`,
    ].join("\n"),
  }

  const userMessage: Message = { role: "user", content: userInput }

  const run = Effect.gen(function* () {
    const registry = yield* ToolRegistry
    const provider = yield* Provider

    const allMessages: Message[] = [systemMessage, ...messages, userMessage]
    const history: Message[] = [...messages, userMessage]

    for (let step = 0; step < maxSteps; step++) {
      const tools = yield* registry.all()
      const toolDefs = convertToolsToDefs(tools)

      const result: CompletionResult = yield* provider.complete({
        model: "big-pickle",
        messages: allMessages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        stream: false,
      })

      const toolCalls = result.message.tool_calls
      const reply: Message = createAssistantMessage({
        content: result.message.content ?? undefined,
        reasoning_content: result.message.reasoning_content ?? undefined,
        tool_calls: toolCalls,
      })
      allMessages.push(reply)
      history.push(reply)

      if (!toolCalls || toolCalls.length === 0) {
        return history
      }

      for (const call of toolCalls) {
        const args = parseToolArgs(call.function.arguments ?? "{}")
        const def = tools.find((t) => t.id === (call.function.name ?? ""))
        if (!def) {
          allMessages.push(createToolMessage({
            tool_call_id: call.id,
            tool: call.function.name,
            output: `Unknown tool: ${call.function.name}`,
            error: true,
          }))
          continue
        }

        yield* config.ask({ permission: def.id, patterns: [call.function.arguments ?? ""] })

        const ctx = new Context({
          abort: config.abort,
          cwd: config.cwd,
          root: config.root,
          ask: (input) => config.ask(input),
          metadata: () => Effect.void,
        })

        const toolResult = yield* def.execute(args, ctx).pipe(
          Effect.catchCause((cause) =>
            Effect.succeed(new Result({ title: "Error", output: `Tool error: ${cause}` }))
          ),
        )

        allMessages.push(createToolMessage({
          tool_call_id: call.id,
          tool: def.id,
          output: convertToolResult(toolResult),
        }))
      }
    }

    return history
  })

  return run.pipe(Effect.orDie)
}

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}
