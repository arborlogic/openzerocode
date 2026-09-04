import { Schema } from "effect"
import { Def, Result } from "../tool/tool"
import { dataUrlFromImage } from "../provider/content"
import type { ToolDef, ContentPart } from "../provider/types"
import { filterImagesForModel, formatImageBudgetNotice } from "../provider/image-budget"
import { truncateToolOutput } from "../tool/truncate"

function removeNullableOptionalProperties(schema: Record<string, unknown>): Record<string, unknown> {
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : [])

  const visit = (value: unknown, propertyName?: string): unknown => {
    if (Array.isArray(value)) return value.map((entry) => visit(entry, propertyName))
    if (!value || typeof value !== "object") return value

    const object = value as Record<string, unknown>
    const next: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(object)) {
      if (key === "properties" && entry && typeof entry === "object" && !Array.isArray(entry)) {
        next[key] = Object.fromEntries(Object.entries(entry as Record<string, unknown>).map(([name, property]) => [name, visit(property, name)]))
      } else if (key === "anyOf" || key === "oneOf") {
        const variants = Array.isArray(entry)
          ? entry.filter((variant) => !(propertyName && !required.has(propertyName) && typeof variant === "object" && variant !== null && (variant as Record<string, unknown>).type === "null"))
          : []
        const visited = variants.map((variant) => visit(variant, propertyName))
        if (visited.length === 1 && visited[0] && typeof visited[0] === "object") Object.assign(next, visited[0])
        else next[key] = visited
      } else {
        next[key] = visit(entry, propertyName)
      }
    }
    return next
  }

  return visit(schema) as Record<string, unknown>
}

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
    // Effect Schema represents optional fields as `value | null`, although the
    // runtime decoder rejects explicit null. Keep the wire schema aligned with
    // execution so models omit optional arguments instead of sending null and
    // wasting a corrective tool round-trip.
    schema = removeNullableOptionalProperties(schema)
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
