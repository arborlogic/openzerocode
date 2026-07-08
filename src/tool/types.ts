import { Effect, Schema } from "effect"

export type Metadata = Record<string, unknown>

export class Context {
  readonly abort: AbortSignal
  readonly cwd: string
  readonly root: string
  readonly ask: (input: Omit<PermissionRequest, "id">) => Effect.Effect<void>
  readonly metadata: (input: { title?: string; metadata?: Metadata }) => Effect.Effect<void>

  constructor(input: {
    abort: AbortSignal
    cwd: string
    root: string
    ask: (input: Omit<PermissionRequest, "id">) => Effect.Effect<void>
    metadata: (input: { title?: string; metadata?: Metadata }) => Effect.Effect<void>
  }) {
    this.abort = input.abort
    this.cwd = input.cwd
    this.root = input.root
    this.ask = input.ask
    this.metadata = input.metadata
  }
}

export type ResultImage = { mimeType: string; base64: string }

export class Result {
  readonly title: string
  readonly output: string
  readonly images?: ResultImage[]
  readonly metadata?: Metadata

  constructor(input: { title: string; output: string; images?: ResultImage[]; metadata?: Metadata }) {
    this.title = input.title
    this.output = input.output
    this.images = input.images
    this.metadata = input.metadata
  }
}

export class Def {
  readonly id: string
  readonly description: string
  readonly parameters: Schema.Struct<Schema.Struct.Fields>
  readonly execute: (args: unknown, ctx: Context) => Effect.Effect<Result>
  /**
   * Optional selection group. Tools with a group are *selectable* — the user
   * can disable the whole group from Experiments → Tools, and disabled groups
   * are filtered out of the tool list sent to the model. Tools without a group
   * are core and always enabled (read/edit/write/bash/grep/glob/web_fetch/todo).
   */
  readonly group?: string
  /**
   * Pre-built JSON Schema for the tool parameters. When set, it is sent to the
   * model verbatim instead of deriving a schema from `parameters`. Used by MCP
   * tools, whose schema already arrives as JSON Schema from the server.
   */
  readonly jsonSchema?: Record<string, unknown>

  constructor(input: {
    id: string
    description: string
    parameters: Schema.Struct<Schema.Struct.Fields>
    execute: (args: unknown, ctx: Context) => Effect.Effect<Result>
    group?: string
    jsonSchema?: Record<string, unknown>
  }) {
    this.id = input.id
    this.description = input.description
    this.parameters = input.parameters
    this.execute = input.execute
    this.group = input.group
    this.jsonSchema = input.jsonSchema
  }
}

export type PermissionRequest = {
  id: string
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
}
