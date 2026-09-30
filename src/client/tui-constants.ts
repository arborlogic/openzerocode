import type { KeyBinding } from "@opentui/core"

export const EMPTY_STATE_MESSAGE = "Response scroll is locked inside the panel. Mouse wheel scrolls response only."

export function idleFooterStatus(status: string, queued: number): string {
  const defaultStatus = status === "waiting for input" || status === "autopilot enabled"
  if (defaultStatus) return queued > 0 ? `${queued} queued` : ""
  return queued > 0 && !status.includes(`${queued} queued`) ? `${status}  •  ${queued} queued` : status
}

export const SIDEBAR_WIDTH = 34

export function sidebarWidthForTerminal(terminalWidth: number) {
  return Math.max(24, Math.min(SIDEBAR_WIDTH, terminalWidth - 4))
}

export const PROMPT_KEY_BINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "return", ctrl: true, action: "newline" },
  { name: "return", meta: true, action: "newline" },
  { name: "j", ctrl: true, action: "newline" },
]
