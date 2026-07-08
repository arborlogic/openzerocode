import type { ContentPart } from "./types"

/** Extract plain text from a Message.content field (string or multimodal ContentPart[]). */
export function contentToText(content: string | ContentPart[] | undefined): string {
  if (!content) return ""
  if (typeof content === "string") return content
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text" && "text" in p)
    .map((p) => p.text)
    .join("\n")
}

export function dataUrlFromImage(input: { mimeType?: string; base64: string }): string {
  const mimeType = normalizeImageMimeType(input.mimeType) ?? "image/png"
  return `data:${mimeType};base64,${input.base64}`
}

export function normalizeImageMimeType(value: string | undefined): string | undefined {
  if (!value) return undefined
  const lower = value.toLowerCase()
  if (lower === "png") return "image/png"
  if (lower === "jpg" || lower === "jpeg") return "image/jpeg"
  if (/^image\/[a-z0-9.+-]+$/.test(lower)) return lower
  return undefined
}

export function parseImageDataUrl(url: string): { mimeType: string; base64: string } | undefined {
  const match = url.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i)
  if (!match) return undefined
  const mimeType = normalizeImageMimeType(match[1])
  if (!mimeType) return undefined
  return { mimeType, base64: match[2]! }
}
