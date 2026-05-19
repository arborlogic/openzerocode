import { Schema } from "effect"
import { Def, Result } from "../tool/tool"
import type { ToolDef } from "../provider/types"
import { truncateToolOutput } from "../tool/truncate"

export function convertToolToDef(def: Def): ToolDef {
  const doc = Schema.toJsonSchemaDocument(def.parameters)
  let schema = (doc.schema ?? doc) as Record<string, unknown>
  // Schema.Struct({}) produces anyOf without type: "object", which OpenAI rejects.
  if (!schema.type || schema.anyOf) {
    schema = { type: "object", properties: {} }
  }
  return {
    type: "function",
    function: {
      name: def.id,
      description: def.description,
      parameters: schema,
    },
  }
}

export function convertToolsToDefs(defs: readonly Def[]): ToolDef[] {
  return defs.map(convertToolToDef)
}

export function convertToolResult(result: Result): string {
  return [result.title, "---", truncateToolOutput(result.output)].join("\n")
}
