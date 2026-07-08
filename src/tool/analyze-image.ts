import { Effect, Schema } from "effect"
import { readFileSync } from "fs"
import { resolve } from "path"
import { Def, Result } from "./types"
import { analyzeImageWithLocalVlm, getDefaultLocalVlmEndpoint, getDefaultLocalVlmModel, type LocalVlmRequest } from "../browser/local-vlm-client"
import { normalizeImageMimeType } from "../provider/content"

const Parameters = Schema.Struct({
  path: Schema.String,
  prompt: Schema.optional(Schema.NullOr(Schema.String)),
  endpoint: Schema.optional(Schema.NullOr(Schema.String)),
  model: Schema.optional(Schema.NullOr(Schema.String)),
})

interface Args {
  path: string
  prompt?: string | null
  endpoint?: string | null
  model?: string | null
}

const DEFAULT_PROMPT = "Describe this image in detail. Focus on key elements, text, UI components, layout, and any notable visual information."
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

type LocalVlmImageFormat = NonNullable<LocalVlmRequest["imageFormat"]>

function detectMimeType(path: string): string | undefined {
  const ext = path.toLowerCase().split(".").pop()
  switch (ext) {
    case "png": return "image/png"
    case "jpg": case "jpeg": case "jpe": return "image/jpeg"
    case "webp": return "image/webp"
    case "gif": return "image/gif"
    case "bmp": return "image/bmp"
    default: return undefined
  }
}

function toLocalVlmImageFormat(mimeType: string | undefined): LocalVlmImageFormat | undefined {
  if (mimeType === "image/png") return "png"
  if (mimeType === "image/jpeg") return "jpeg"
  // local-vlm-client currently accepts only png/jpeg; use png as a conservative
  // generic image fallback for OpenAI-compatible servers while preserving the
  // original mime type in tool result contentParts.
  return undefined
}

export const AnalyzeImageTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "analyze_image",
    description: [
      "Analyze an image file using a local vision language model (VLM).",
      "Returns a textual description of the image content.",
      "Use when you need to understand the content of an image, screenshot, diagram, chart, or any visual file.",
      "Supports PNG, JPEG, and other common image formats.",
      "Requires a local VLM server (e.g., llava via llama.cpp or OpenAI-compatible endpoint).",
      "Configure via OPENZEROCODE_VLM_URL and OPENZEROCODE_VLM_MODEL env vars.",
    ].join("\n"),
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<Args>

        yield* ctx.ask({
          permission: "analyze_image",
          patterns: [args.path],
          metadata: { path: args.path, prompt: args.prompt },
        })

        const resolvedPath = resolve(args.path)
        const mimeType = normalizeImageMimeType(detectMimeType(resolvedPath)) ?? "image/png"

        let buffer: Buffer
        try {
          buffer = readFileSync(resolvedPath)
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          return new Result({ title: "File Error", output: `Failed to read image file: ${msg}` })
        }

        if (buffer.length > MAX_FILE_SIZE) {
          return new Result({ title: "File Too Large", output: `Image file exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit (${(buffer.length / 1024 / 1024).toFixed(1)}MB)` })
        }

        if (buffer.length === 0) {
          return new Result({ title: "Empty File", output: "Image file is empty." })
        }

        const base64 = buffer.toString("base64")
        const endpoint = args.endpoint || getDefaultLocalVlmEndpoint()
        const model = args.model || getDefaultLocalVlmModel()

        try {
          const analysis = yield* Effect.promise(() => analyzeImageWithLocalVlm({
            endpoint,
            model,
            prompt: args.prompt?.trim() || DEFAULT_PROMPT,
            imageBase64: base64,
            imageFormat: toLocalVlmImageFormat(mimeType),
          }))

          return new Result({
            title: `Image Analysis: ${args.path}`,
            output: [
              analysis.text,
              "",
              `VLM: ${analysis.endpoint} (${analysis.api}${analysis.model ? `, model=${analysis.model}` : ""})`,
              `Source: ${resolvedPath} (${buffer.length} bytes)`,
            ].join("\n"),
            images: [{ mimeType, base64 }],
            metadata: { path: resolvedPath, mimeType, bytes: buffer.length },
          })
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          return new Result({
            title: "VLM Error",
            output: [
              `Failed to analyze image with local VLM: ${msg}`,
              "",
              "Ensure a VLM server is running and accessible.",
              `Endpoint: ${endpoint}`,
              `Model: ${model}`,
              "",
              "Configure via OPENZEROCODE_VLM_URL and OPENZEROCODE_VLM_MODEL env vars.",
            ].join("\n"),
          })
        }
      }).pipe(Effect.orDie),
  })
})
