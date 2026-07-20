import type { CliRenderer } from "@opentui/core"

/**
 * OpenTUI normally emits only cells that differ from its previous framebuffer.
 * After a terminal loses focus, that framebuffer may no longer describe what is
 * actually visible (another tab/pane can repaint the surface). Marking the next
 * frame as full prevents stale glyphs, missing colors, and displaced fragments.
 *
 * OpenTUI 0.4.x has no public full-repaint method. The renderer already uses
 * this flag for resume and capability changes, so keep the compatibility shim
 * isolated here until a public API is available.
 */
export function forceFullTerminalRepaint(renderer: CliRenderer): void {
  const repaintable = renderer as unknown as { forceFullRepaintRequested: boolean }
  repaintable.forceFullRepaintRequested = true
  renderer.requestRender()
}

export const REPAINT_SETTLE_DELAYS_MS = [40, 140] as const

/**
 * Coalesces repeated focus/resize events and repaints again after layout and
 * asynchronous syntax renderables have settled.
 */
export function createStableRepaintScheduler(
  renderer: CliRenderer,
  schedule: (callback: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
) {
  let timers: ReturnType<typeof setTimeout>[] = []

  const clearPending = () => {
    for (const timer of timers) cancel(timer)
    timers = []
  }

  const repaint = () => {
    clearPending()
    forceFullTerminalRepaint(renderer)
    timers = REPAINT_SETTLE_DELAYS_MS.map((delay) =>
      schedule(() => forceFullTerminalRepaint(renderer), delay),
    )
  }

  return { repaint, dispose: clearPending }
}
