import type { CliRendererConfig } from "@opentui/core"

export const MAX_MOUNTED_TRANSCRIPT_TURNS = 60
// This is a conservative estimate of native TextBuffer pressure, not a block
// count. Tool rows and Markdown commonly allocate several buffers each.
export const MAX_MOUNTED_TRANSCRIPT_WEIGHT = 320
export const MAX_MOUNTED_WEIGHT_PER_TURN = 120
// Backwards-compatible names for integrations importing the old constants.
export const MAX_MOUNTED_TRANSCRIPT_BLOCKS = MAX_MOUNTED_TRANSCRIPT_WEIGHT
export const MAX_MOUNTED_BLOCKS_PER_TURN = MAX_MOUNTED_WEIGHT_PER_TURN

/**
 * Completed transcript content may belong to a session opened from a different
 * workspace than the process's current directory. Preserve the workspace saved
 * with the session so relative file links continue to point at the right file.
 */
export function resolveTranscriptCwd(sessionDirectory: string | undefined, currentDirectory: string): string {
  return sessionDirectory ?? currentDirectory
}

type HideableTranscriptBlock = { hidden?: boolean }

/**
 * Suppress the oldest visible blocks in an unusually large turn while keeping
 * every positional slot intact. Keeping the slots avoids shifting Solid's
 * nested <Index> renderables when tool calls append or display settings change.
 */
export function limitMountedTurnBlocks<T extends { entries: B[] }, B extends HideableTranscriptBlock>(
  turn: T,
  options: number | { maxWeight?: number; weight?: (block: B) => number } = {},
): T & { omittedMountedBlocks?: number } {
  const normalized = typeof options === "number" ? { maxWeight: options } : options
  const safeLimit = Math.max(1, Math.floor(normalized.maxWeight ?? MAX_MOUNTED_WEIGHT_PER_TURN))
  const weight = normalized.weight ?? (() => 1)
  let mountedWeight = 0
  let omitted = 0
  const entries = [...turn.entries]

  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index]!
    if (entry.hidden) continue
    const entryWeight = Math.max(1, Math.floor(weight(entry) || 1))
    if (mountedWeight === 0 || mountedWeight + entryWeight <= safeLimit) {
      mountedWeight += entryWeight
      continue
    }
    entries[index] = { ...entry, hidden: true }
    omitted++
  }

  if (omitted === 0) return { ...turn, entries }
  return { ...turn, entries, omittedMountedBlocks: omitted }
}

type TranscriptWindowOptions<T> = {
  maxTurns?: number
  maxWeight?: number
  weight?: (turn: T) => number
}

export function mountedTranscriptWindow<T>(
  turns: readonly T[],
  options: number | TranscriptWindowOptions<T> = {},
): {
  turns: T[]
  omitted: number
} {
  const normalized = typeof options === "number" ? { maxTurns: options } : options
  const maxTurns = Math.max(1, Math.floor(normalized.maxTurns ?? MAX_MOUNTED_TRANSCRIPT_TURNS))
  const maxWeight = Math.max(1, Math.floor(normalized.maxWeight ?? MAX_MOUNTED_TRANSCRIPT_BLOCKS))
  const weight = normalized.weight ?? (() => 1)

  let start = turns.length
  let mountedWeight = 0
  while (start > 0 && turns.length - start < maxTurns) {
    const nextWeight = Math.max(1, Math.floor(weight(turns[start - 1]) || 1))
    // Always retain the newest turn. Callers should use limitMountedTurnBlocks
    // first so a single tool-heavy turn cannot bypass the global budget.
    if (start < turns.length && mountedWeight + nextWeight > maxWeight) break
    start--
    mountedWeight += nextWeight
  }

  const omitted = start
  return {
    turns: turns.slice(start),
    omitted,
  }
}

export function createTuiRendererConfig(
  copySelection: (text: string) => void | Promise<unknown>,
): CliRendererConfig {
  return {
    // Keep OpenTUI's useful automatic error console, but wire its otherwise
    // unset copy callback so the focused console's Copy action actually works.
    openConsoleOnError: true,
    consoleOptions: {
      onCopySelection: (text) => {
        void copySelection(text)
      },
    },
  }
}
