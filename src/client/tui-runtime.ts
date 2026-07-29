import type { CliRendererConfig } from "@opentui/core"

export const MAX_MOUNTED_TRANSCRIPT_TURNS = 160

export function mountedTranscriptWindow<T>(turns: readonly T[], limit = MAX_MOUNTED_TRANSCRIPT_TURNS): {
  turns: T[]
  omitted: number
} {
  const safeLimit = Math.max(1, Math.floor(limit))
  const omitted = Math.max(0, turns.length - safeLimit)
  return {
    turns: omitted > 0 ? turns.slice(omitted) : [...turns],
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
