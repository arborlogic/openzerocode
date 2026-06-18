import { Effect, Schema } from "effect"
import { Def, Result } from "../tool/types"
import type { McpClient } from "./client"
import type { McpToolSpec } from "./protocol"
import { mcpGroupId } from "./config"

/** Truncate a value for a permission-prompt preview line. */
function preview(args: Record<string, unknown>): string {
  const text = JSON.stringify(args)
  return text.length > 120 ? text.slice(0, 120) + "…" : text
}

/**
 * Wrap a single MCP tool as an openzerocode tool Def. The tool id is namespaced
 * by server (`<serverId>__<name>`) to avoid collisions, the server's JSON Schema
 * is passed through verbatim, and execution routes through the MCP client after
 * the standard permission prompt.
 */
export function mcpToolToDef(serverId: string, client: McpClient, spec: McpToolSpec): Def {
  const id = `${serverId}__${spec.name}`
  const inputSchema =
    spec.inputSchema && typeof spec.inputSchema === "object"
      ? spec.inputSchema
      : { type: "object", properties: {} }

  return new Def({
    id,
    description: spec.description ?? `MCP tool ${spec.name} from ${serverId}`,
    parameters: Schema.Struct({}),
    group: mcpGroupId(serverId),
    jsonSchema: inputSchema,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>

        yield* ctx.ask({
          permission: id,
          patterns: [`${spec.name} ${preview(args)}`],
        })

        if (!client.running) {
          return new Result({ title: "Error", output: `MCP server "${serverId}" is not running.` })
        }

        const output = yield* Effect.promise(() =>
          client
            .callTool(spec.name, args)
            .catch((e) => `Error: ${e instanceof Error ? e.message : String(e)}`),
        )

        const isError = output.startsWith("Error:")
        return new Result({ title: isError ? "Error" : spec.name, output })
      }).pipe(Effect.orDie),
  })
}
