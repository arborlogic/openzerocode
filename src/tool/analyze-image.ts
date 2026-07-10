import { Effect, Schema } from "effect"
import { readFileSync } from "fs"
import { resolve } from "path"
import { Def, Result } from "./types"
import { analyzeImageWithLocalVlm, getDefaultLocalVlmEndpoint, getDefaultLocalVlmModel, shouldForceLocalVlm, type LocalVlmRequest } from "../browser/local-vlm-client"
import { normalizeImageMimeType } from "../provider/content"
import { modelSupportsVision } from "../provider/models"

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

function prefersNativeVision(ctxModel: string | undefined, args: Args): boolean {
  // Explicit local VLM overrides, or the command-palette preference, always
  // force the local path without changing the active chat LLM provider/model.
  if (args.endpoint?.trim() || args.model?.trim() || shouldForceLocalVlm()) return false
  if (!ctxModel) return false
  return modelSupportsVision(ctxModel)
}

export const AnalyzeImageTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)
  return new Def({
    id: "analyze_image",
    description: [
      "Analyze an image file (PNG, JPEG, and other common formats).",
      "If the current chat model supports vision natively, the image is attached directly for provider vision analysis (no local VLM hop).",
      "If the model does not support vision, falls back to a local VLM and returns a textual description.",
      "Optional endpoint/model override force the local VLM path even when the chat model supports vision.",
      "Configure the local VLM via OPENZEROCODE_VLM_URL and OPENZEROCODE_VLM_MODEL env vars.",
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
        const image = { mimeType, base64 }

        // Prefer the chat model's native vision when available. Local VLM is only
        // used as a fallback (or when endpoint/model are explicitly overridden).
        if (prefersNativeVision(ctx.model, args)) {
          return new Result({
            title: `Image: ${args.path}`,
            output: [
              "Image attached for native model vision analysis.",
              args.prompt?.trim() ? `Requested focus: ${args.prompt.trim()}` : undefined,
              `Source: ${resolvedPath} (${buffer.length} bytes)`,
              `Mime: ${mimeType}`,
              `Chat model: ${ctx.model}`,
            ].filter(Boolean).join("\n"),
            images: [image],
            metadata: {
              path: resolvedPath,
              mimeType,
              bytes: buffer.length,
              analysisPath: "native",
              model: ctx.model,
            },
          })
        }

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
            // Always attach the original image so vision-capable providers can
            // re-analyze it natively after the local VLM summary (e.g. when
            // model capability was unknown at tool time).
            images: [image],
            metadata: {
              path: resolvedPath,
              mimeType,
              bytes: buffer.length,
              analysisPath: "local_vlm",
            },
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
              "",
              "The original image is still attached below for vision-capable models.",
              `Source: ${resolvedPath} (${buffer.length} bytes)`,
            ].join("\n"),
            // Keep the image even when the local VLM is down/slow so Grok/GPT/etc
            // can still inspect it through the provider vision path.
            images: [image],
            metadata: {
              path: resolvedPath,
              mimeType,
              bytes: buffer.length,
              analysisPath: "local_vlm_error",
            },
          })
        }
      }).pipe(Effect.orDie),
  })
})
