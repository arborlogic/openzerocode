import { Schema } from "effect"
import { Def, Result } from "../tool/tool"
import { dataUrlFromImage } from "../provider/content"
import type { ToolDef, ContentPart } from "../provider/types"
import { filterImagesForModel, formatImageBudgetNotice } from "../provider/image-budget"
import { truncateToolOutput } from "../tool/truncate"

export function convertToolToDef(def: Def): ToolDef {
  let schema: Record<string, unknown>
  if (def.jsonSchema) {
    // MCP tools arrive with a ready JSON Schema; pass it through, only ensuring
    // a top-level object type so providers like OpenAI accept it.
    schema = def.jsonSchema.type ? def.jsonSchema : { type: "object", properties: {}, ...def.jsonSchema }
  } else {
    const doc = Schema.toJsonSchemaDocument(def.parameters)
    schema = (doc.schema ?? doc) as Record<string, unknown>
    // Schema.Struct({}) produces anyOf without type: "object", which OpenAI rejects.
    if (!schema.type || schema.anyOf) {
      schema = { type: "object", properties: {} }
    }
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

export type ToolResultContent = {
  text: string
  contentParts?: ContentPart[]
}

export function convertToolResult(result: Result): ToolResultContent {
  const imageBudget = filterImagesForModel(result.images)
  const budgetNotice = formatImageBudgetNotice(imageBudget.skipped)
  const text = [result.title, "---", truncateToolOutput(result.output) + budgetNotice].join("\n")

  if (imageBudget.images.length === 0) {
    return { text }
  }

  const contentParts: ContentPart[] = [{ type: "text", text }]
  for (const img of imageBudget.images) {
    contentParts.push({
      type: "image_url",
      image_url: { url: dataUrlFromImage(img) },
    })
  }
  return { text, contentParts }
}
