import assert from "node:assert"
import { describe, it } from "node:test"
import type { CliRenderer } from "@opentui/core"
import {
  REPAINT_SETTLE_DELAYS_MS,
  createStableRepaintScheduler,
  forceFullTerminalRepaint,
} from "./tui-render-stability"

function rendererStub() {
  let renders = 0
  const renderer = {
    requestRender: () => { renders++ },
  } as unknown as CliRenderer
  return { renderer, renders: () => renders }
}

describe("terminal repaint stability", () => {
  it("requests a full repaint rather than a differential frame", () => {
    const { renderer, renders } = rendererStub()

    forceFullTerminalRepaint(renderer)

    assert.equal((renderer as any).forceFullRepaintRequested, true)
    assert.equal(renders(), 1)
  })

  it("repaints immediately and after layout settles", () => {
    const { renderer, renders } = rendererStub()
    const callbacks: Array<() => void> = []
    const delays: number[] = []
    const scheduler = createStableRepaintScheduler(
      renderer,
      (callback, delay) => {
        callbacks.push(callback)
        delays.push(delay)
        return callbacks.length as unknown as ReturnType<typeof setTimeout>
      },
      () => {},
    )

    scheduler.repaint()
    assert.equal(renders(), 1)
    assert.deepEqual(delays, [...REPAINT_SETTLE_DELAYS_MS])

    callbacks.forEach((callback) => callback())
    assert.equal(renders(), 3)
  })

  it("cancels stale settling frames when another event arrives", () => {
    const { renderer } = rendererStub()
    const cancelled: unknown[] = []
    let nextTimer = 0
    const scheduler = createStableRepaintScheduler(
      renderer,
      () => ++nextTimer as unknown as ReturnType<typeof setTimeout>,
      (timer) => cancelled.push(timer),
    )

    scheduler.repaint()
    scheduler.repaint()

    assert.deepEqual(cancelled, [1, 2])
    scheduler.dispose()
    assert.deepEqual(cancelled, [1, 2, 3, 4])
  })
})
