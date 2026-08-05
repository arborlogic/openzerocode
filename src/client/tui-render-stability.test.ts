import assert from "node:assert"
import { describe, it } from "node:test"
import type { CliRenderer } from "@opentui/core"
import {
  REPAINT_SETTLE_DELAYS_MS,
  createStableRepaintScheduler,
  forceFullTerminalRepaint,
} from "./tui-render-stability"
import {
  createTuiRendererConfig,
  limitMountedTurnBlocks,
  MAX_MOUNTED_BLOCKS_PER_TURN,
  MAX_MOUNTED_TRANSCRIPT_BLOCKS,
  MAX_MOUNTED_TRANSCRIPT_TURNS,
  mountedTranscriptWindow,
} from "./tui-runtime"

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

describe("OpenTUI runtime helpers", () => {
  it("configures TerminalConsole copy selection for the focused console", () => {
    const copied: string[] = []
    const config = createTuiRendererConfig((text) => { copied.push(text) })

    config.consoleOptions?.onCopySelection?.("selected console text")

    assert.equal(config.openConsoleOnError, true)
    assert.deepEqual(copied, ["selected console text"])
  })
})

describe("mountedTranscriptWindow", () => {
  it("keeps short transcripts mounted without aliasing the caller array", () => {
    const turns = ["a", "b"]

    const window = mountedTranscriptWindow(turns, 5)

    assert.deepEqual(window, { turns: ["a", "b"], omitted: 0 })
    assert.notEqual(window.turns, turns)
  })

  it("unmounts older turns so TextBuffer/TextBufferView renderables cannot accumulate forever", () => {
    const turns = Array.from({ length: MAX_MOUNTED_TRANSCRIPT_TURNS + 2 }, (_, index) => `turn-${index}`)

    const window = mountedTranscriptWindow(turns)

    assert.equal(window.omitted, 2)
    assert.equal(window.turns.length, MAX_MOUNTED_TRANSCRIPT_TURNS)
    assert.equal(window.turns[0], "turn-2")
    assert.equal(window.turns.at(-1), `turn-${MAX_MOUNTED_TRANSCRIPT_TURNS + 1}`)
  })

  it("normalizes invalid limits to at least one mounted turn", () => {
    const window = mountedTranscriptWindow(["old", "new"], 0)

    assert.deepEqual(window, { turns: ["new"], omitted: 1 })
  })

  it("also bounds renderable weight when a turn contains many blocks", () => {
    const turns = [
      { id: "old", blocks: MAX_MOUNTED_TRANSCRIPT_BLOCKS },
      { id: "middle", blocks: 2_500 },
      { id: "new", blocks: 2_000 },
    ]

    const window = mountedTranscriptWindow(turns, {
      weight: (turn) => turn.blocks,
    })

    assert.deepEqual(window.turns.map((turn) => turn.id), ["new"])
    assert.equal(window.omitted, 2)
  })

  it("always keeps the newest turn when it alone exceeds the weight budget", () => {
    const turns = [{ blocks: 1 }, { blocks: MAX_MOUNTED_TRANSCRIPT_BLOCKS + 1 }]

    const window = mountedTranscriptWindow(turns, {
      weight: (turn) => turn.blocks,
    })

    assert.deepEqual(window, { turns: [turns[1]], omitted: 1 })
  })

  it("suppresses old blocks inside one tool-heavy newest turn", () => {
    const turn = {
      entries: Array.from(
        { length: MAX_MOUNTED_BLOCKS_PER_TURN + 2 },
        (_, index) => ({ id: index, hidden: false }),
      ),
    }

    const limited = limitMountedTurnBlocks(turn)

    assert.equal(limited.omittedMountedBlocks, 2)
    assert.equal(limited.entries.length, turn.entries.length)
    assert.deepEqual(limited.entries.slice(0, 3).map((entry) => entry.hidden), [true, true, false])
    assert.equal(turn.entries[0]?.hidden, false)
  })

  it("does not spend the per-turn budget on already-hidden tool slots", () => {
    const turn = {
      entries: [
        ...Array.from({ length: 20 }, () => ({ hidden: true })),
        { hidden: false },
        { hidden: false },
      ],
    }

    const limited = limitMountedTurnBlocks(turn, 2)

    assert.equal(limited.omittedMountedBlocks, undefined)
    assert.equal(limited.entries.filter((entry) => !entry.hidden).length, 2)
  })
})
