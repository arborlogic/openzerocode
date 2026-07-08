import type { ResultImage } from "../tool/types"

export const DEFAULT_MAX_IMAGE_BYTES_FOR_MODEL = 1_500_000

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

export function getMaxImageBytesForModel(): number {
  return clampInt(process.env.OPENZEROCODE_MODEL_IMAGE_MAX_BYTES, DEFAULT_MAX_IMAGE_BYTES_FOR_MODEL, 0, 25 * 1024 * 1024)
}

export function estimateBase64DecodedBytes(base64: string): number {
  const normalized = base64.trim()
  if (normalized.length === 0) return 0
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding)
}

export type ImageBudgetResult = {
  images: ResultImage[]
  skipped: Array<{ index: number; mimeType?: string; bytes: number; maxBytes: number }>
}

export function filterImagesForModel(images: readonly ResultImage[] | undefined, maxBytes = getMaxImageBytesForModel()): ImageBudgetResult {
  if (!images || images.length === 0) return { images: [], skipped: [] }
  if (maxBytes <= 0) {
    return {
      images: [],
      skipped: images.map((image, index) => ({ index, mimeType: image.mimeType, bytes: estimateBase64DecodedBytes(image.base64), maxBytes })),
    }
  }

  const kept: ResultImage[] = []
  const skipped: ImageBudgetResult["skipped"] = []
  for (const [index, image] of images.entries()) {
    const bytes = estimateBase64DecodedBytes(image.base64)
    if (bytes > maxBytes) {
      skipped.push({ index, mimeType: image.mimeType, bytes, maxBytes })
      continue
    }
    kept.push(image)
  }
  return { images: kept, skipped }
}

export function formatImageBudgetNotice(skipped: readonly ImageBudgetResult["skipped"][number][]): string {
  if (skipped.length === 0) return ""
  const lines = skipped.map((item) => {
    const mb = (item.bytes / 1024 / 1024).toFixed(2)
    const maxMb = (item.maxBytes / 1024 / 1024).toFixed(2)
    return `- image #${item.index + 1}${item.mimeType ? ` (${item.mimeType})` : ""}: ${mb}MB exceeds ${maxMb}MB model attachment budget`
  })
  return [
    "",
    "[Image attachment skipped to save bandwidth/tokens]",
    ...lines,
    "Set OPENZEROCODE_MODEL_IMAGE_MAX_BYTES to adjust the per-image attachment limit.",
  ].join("\n")
}
