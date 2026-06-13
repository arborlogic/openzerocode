import type { KeyBinding } from "@opentui/core"

export const EMPTY_STATE_MESSAGE = "Response scroll is locked inside the panel. Mouse wheel scrolls response only."
export const SCROLL_HINT = "Enter submit  •  Shift/Ctrl/Alt+Enter newline  •  / commands  •  Ctrl+P / F2 palette"
export const SIDEBAR_WIDTH = 34

export const PROMPT_KEY_BINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "return", shift: true, action: "newline" },
  { name: "return", ctrl: true, action: "newline" },
  { name: "return", meta: true, action: "newline" },
  { name: "j", ctrl: true, action: "newline" },
]
