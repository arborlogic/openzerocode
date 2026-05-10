import { Schema } from "effect"
import { Def, Context, Result } from "../tool/tool"
import type { ToolDef } from "../provider/types"

export function convertToolToDef(def: Def): ToolDef {
  const doc = Schema.toJsonSchemaDocument(def.parameters)
  const schema = doc.schema ?? doc
  return {
    type: "function",
    function: {
      name: def.id,
      description: def.description,
      parameters: schema as unknown as Record<string, unknown>,
    },
  }
}

export function convertToolsToDefs(defs: readonly Def[]): ToolDef[] {
  return defs.map(convertToolToDef)
}

export function convertToolResult(result: Result): string {
  return [result.title, "---", result.output].join("\n")
}
