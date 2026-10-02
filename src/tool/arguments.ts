import { Schema } from "effect"
import { Def, Result } from "./types"

export type ParsedToolArguments =
  | { ok: true; value: unknown }
  | { ok: false; result: Result }

function receivedArguments(value: unknown): string {
  try {
    const text = JSON.stringify(value)
    return text.length > 240 ? `${text.slice(0, 237)}...` : text
  } catch {
    return String(value)
  }
}

function validationDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const missing = message.match(/Missing key\s*\n\s*at \["([^\"]+)"\]/)
  if (missing?.[1]) return `missing required parameter "${missing[1]}"`
  return message.replace(/\s*\n\s*/g, " ").trim() || "arguments do not match the tool schema"
}

/** Parse and validate provider-supplied arguments before a tool is shown as running. */
export function parseToolArguments(def: Def, raw: string | undefined): ParsedToolArguments {
  const source = raw ?? "{}"
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return {
      ok: false,
      result: new Result({
        title: "Error",
        output: `Invalid arguments for tool "${def.id}": arguments are not valid JSON. Please retry with a complete JSON object matching the tool schema.`,
      }),
    }
  }

  try {
    // Def intentionally accepts schemas that may declare decoding services, while
    // registered tool parameter schemas are all synchronous at this boundary.
    // MCP tools use an empty local Struct and delegate validation to the server;
    // preserve their arguments instead of stripping every undeclared property.
    return { ok: true, value: Schema.decodeUnknownSync(def.parameters as unknown as Schema.Decoder<unknown, never>)(parsed, { onExcessProperty: "preserve" }) }
  } catch (error) {
    return {
      ok: false,
      result: new Result({
        title: "Error",
        output: `Invalid arguments for tool "${def.id}": ${validationDetail(error)}. Received: ${receivedArguments(parsed)}. Please retry with arguments matching the tool schema.`,
      }),
    }
  }
}
