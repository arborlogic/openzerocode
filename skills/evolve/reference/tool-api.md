# Tool API Reference

## File Format

```ts
import { Effect, Schema } from "effect"
import { Def, Result } from "@openzerocode/tool"

// Single tool (named export — no default export pattern)
const Parameters = Schema.Struct({
  param1: Schema.String,
})

export const MyTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "my-tool",
    description: "What this tool does",
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw)
        return new Result({ title: "My Tool", output: `Result: ${args.param1}` })
      }),
  })
})
```

## Schema (Effect Schema)

```ts
Schema.String                             // string parameter
Schema.optional(Schema.Number)            // optional number
Schema.Struct({ key: Schema.String })     // object with known keys
Schema.Array(Schema.String)               // array of strings
Schema.Union(Schema.Literal("a"), Schema.Literal("b"))  // enum-like
```

## ToolContext (ctx)

```ts
type Context = {
  cwd: string             // Project root (use for file paths)
  root: string            // Git worktree root
  abort: AbortSignal      // Cancelled when user interrupts
  model?: string          // Active chat model id
  ask(input: {            // Request user permission before a sensitive action
    permission: string    // Permission name (e.g. "read", "edit", "bash")
    patterns: string[]    // What's being accessed (shown to user)
  }): Effect.Effect<void>
  metadata(input: {       // Update tool call display
    title?: string
    metadata?: Record<string, unknown>
  }): Effect.Effect<void>
}
```

## Return Value

```ts
// Return a Result instance
return new Result({ title: "Tool Name", output: "Result text shown to LLM" })

// With images
return new Result({
  title: "Tool Name",
  output: "Result text",
  images: [{ mimeType: "image/png", base64: "..." }],
})

// With metadata
return new Result({
  title: "Tool Name",
  output: "Result text",
  metadata: { files_changed: 3, duration_ms: 1200 },
})
```

## Examples

### Wrap a shell command
```ts
import { Effect, Schema } from "effect"
import { Def, Result } from "@openzerocode/tool"
import { execSync } from "child_process"

const Parameters = Schema.Struct({
  port: Schema.Number,
})

export const PortCheckTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "port-check",
    description: "Check if a port is in use",
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw)
        try {
          const result = execSync(`lsof -i :${args.port}`, { encoding: "utf-8", cwd: ctx.cwd })
          return new Result({ title: `Port ${args.port}`, output: `Port ${args.port} is in use:\n${result}` })
        } catch {
          return new Result({ title: `Port ${args.port}`, output: `Port ${args.port} is free` })
        }
      }),
  })
})
```

### HTTP API call
```ts
import { Effect, Schema } from "effect"
import { Def, Result } from "@openzerocode/tool"

const Parameters = Schema.Struct({
  endpoint: Schema.optional(Schema.String),
})

export const HealthCheckTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "health-check",
    description: "Query project's health endpoint",
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw)
        const url = `http://localhost:3000${args.endpoint ?? "/health"}`
        const res = yield* Effect.promise(() => fetch(url, { signal: ctx.abort }))
        const body = yield* Effect.promise(() => res.text())
        return new Result({ title: "Health Check", output: `${res.status} ${res.statusText}\n${body}` })
      }),
  })
})
```

## Constraints

- Output truncated at 50KB / 2000 lines
- Use `ctx.abort` for cancellable long-running operations
- Tool id is derived from filename (e.g., `deploy-check.ts` → tool id `deploy-check`)
- Same id as a builtin overrides it (bash, read, edit, write, glob, grep, etc.)
