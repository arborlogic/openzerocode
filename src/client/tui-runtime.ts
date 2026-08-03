import type { CliRendererConfig } from "@opentui/core"

export const MAX_MOUNTED_TRANSCRIPT_TURNS = 160
export const MAX_MOUNTED_TRANSCRIPT_BLOCKS = 4_000

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
    // Always retain the newest turn, even when that turn alone exceeds the
    // budget. This avoids presenting an empty transcript during a large reply.
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
  copySelection: (text: string) => void | Promise<void>,
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
