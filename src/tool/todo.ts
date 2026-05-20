import { Effect, Schema } from "effect"
import { Def, Result } from "./types"

export type TodoStatus = "pending" | "in_progress" | "completed"
export type TodoPriority = "high" | "medium" | "low"

export type TodoItem = {
  content: string
  status: TodoStatus
  priority?: TodoPriority
}

let onUpdate: ((todos: TodoItem[]) => void) | null = null

export function setTodoUpdateCallback(fn: (todos: TodoItem[]) => void) {
  onUpdate = fn
}

const TodoItemSchema = Schema.Struct({
  content: Schema.String,
  status: Schema.Literals(["pending", "in_progress", "completed"]),
  priority: Schema.optional(Schema.Literals(["high", "medium", "low"])),
})

const Parameters = Schema.Struct({
  todos: Schema.Array(TodoItemSchema),
})

export const TodoWriteTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "todowrite",
    description: "Write or update a structured task list for the current work. Use before starting multi-step tasks to show planned steps, and update status as work progresses.",
    parameters: Parameters,
    execute: (raw, _ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw)
        const todos: TodoItem[] = args.todos.map(t => ({
          content: t.content,
          status: t.status as TodoStatus,
          priority: t.priority as TodoPriority | undefined,
        }))
        onUpdate?.(todos)
        const done = todos.filter(t => t.status === "completed").length
        return new Result({
          title: "Todo list updated",
          output: `Updated ${todos.length} task(s) — ${done} completed.`,
        })
      }).pipe(Effect.orDie),
  })
})
