import { THEME } from "./theme"

/**
 * Shared diff colors. Keep added/removed backgrounds on both the gutter and
 * code content; containment is handled by repainting chat/scroll containers
 * with the normal app background so colored diff rows cannot leave scroll
 * artifacts in unrelated response messages.
 */
export const DIFF_RENDER_PROPS = {
  contextBg: "transparent",
  lineNumberBg: "transparent",
  addedLineNumberBg: THEME.diffAddedBg,
  removedLineNumberBg: THEME.diffRemovedBg,
} as const
