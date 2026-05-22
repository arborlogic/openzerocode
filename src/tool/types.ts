import { Effect, Schema } from "effect"

export type Metadata = Record<string, unknown>

export class Context {
  readonly abort: AbortSignal
  readonly cwd: string
  readonly root: string
  readonly ask: (input: Omit<PermissionRequest, "id">) => Effect.Effect<void>
  readonly metadata: (input: { title?: string; metadata?: Metadata }) => Effect.Effect<void>
  readonly recoveryGroupId?: string

  constructor(input: {
    abort: AbortSignal
    cwd: string
    root: string
    ask: (input: Omit<PermissionRequest, "id">) => Effect.Effect<void>
    metadata: (input: { title?: string; metadata?: Metadata }) => Effect.Effect<void>
    recoveryGroupId?: string
  }) {
    this.abort = input.abort
    this.cwd = input.cwd
    this.root = input.root
    this.ask = input.ask
    this.metadata = input.metadata
    this.recoveryGroupId = input.recoveryGroupId
  }
}

export class Result {
  readonly title: string
  readonly output: string
  readonly metadata?: Metadata

  constructor(input: { title: string; output: string; metadata?: Metadata }) {
    this.title = input.title
    this.output = input.output
    this.metadata = input.metadata
  }
}

export class Def {
  readonly id: string
  readonly description: string
  readonly parameters: Schema.Struct<Schema.Struct.Fields>
  readonly execute: (args: unknown, ctx: Context) => Effect.Effect<Result>

  constructor(input: {
    id: string
    description: string
    parameters: Schema.Struct<Schema.Struct.Fields>
    execute: (args: unknown, ctx: Context) => Effect.Effect<Result>
  }) {
    this.id = input.id
    this.description = input.description
    this.parameters = input.parameters
    this.execute = input.execute
  }
}

export type PermissionRequest = {
  id: string
  permission: string
  patterns: string[]
  metadata?: Record<string, unknown>
}
