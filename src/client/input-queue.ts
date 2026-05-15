export type QueueItem = {
  text: string
  timestamp: number
}

export type RunPromptFn = (item: QueueItem, signal: AbortSignal) => Promise<void>

export type QueueCallbacks = {
  onRunStart?: (item: QueueItem) => void
  onRunEnd?: (item: QueueItem, result: "done" | "error" | "aborted") => void
  onDepthChange?: (depth: number) => void
  onDrainStart?: () => void
  onDrainEnd?: () => void
}

export function createInputQueue(run: RunPromptFn, callbacks?: QueueCallbacks) {
  const queue: QueueItem[] = []
  let running = false
  let draining = false
  let currentAbort: AbortController | undefined
  let drainPromise: Promise<void> | undefined

  // depth = number of items waiting (not including the currently running one)
  const depth = () => Math.max(0, queue.length - (running ? 1 : 0))
  const notifyDepth = () => callbacks?.onDepthChange?.(depth())

  const drainLoop = async (): Promise<void> => {
    if (draining) return
    draining = true
    callbacks?.onDrainStart?.()

    try {
      while (queue.length > 0) {
        const item = queue[0]!
        running = true
        currentAbort = new AbortController()
        callbacks?.onRunStart?.(item)
        notifyDepth()

        try {
          await run(item, currentAbort.signal)
          callbacks?.onRunEnd?.(item, "done")
        } catch (err: unknown) {
          if (err instanceof Error && (err.name === "AbortError" || err.message === "aborted")) {
            callbacks?.onRunEnd?.(item, "aborted")
          } else {
            callbacks?.onRunEnd?.(item, "error")
          }
        } finally {
          queue.shift()
          running = false
          currentAbort = undefined
          notifyDepth()
        }
      }
    } finally {
      draining = false
      running = false
      currentAbort = undefined
      notifyDepth()
      callbacks?.onDrainEnd?.()
    }
  }

  const enqueue = (text: string) => {
    queue.push({ text, timestamp: Date.now() })
    notifyDepth()
    if (!draining) {
      drainPromise = drainLoop()
    }
  }

  const abort = () => {
    const hadRunning = !!currentAbort
    currentAbort?.abort()
    // Clear all pending items from the queue.
    // If something is running, keep its slot at [0] so the drain loop's
    // finally block can shift() it safely; discard everything else.
    if (running && queue.length > 1) {
      queue.splice(1)
    } else if (!running) {
      queue.length = 0
    }
    notifyDepth()
    return hadRunning
  }

  const clear = () => {
    const count = queue.length - (running ? 1 : 0)
    if (running) {
      queue.splice(1) // keep index 0 (running item)
    } else {
      queue.length = 0
    }
    notifyDepth()
    return count
  }

  return {
    enqueue,
    abort,
    clear,
    depth,
    isRunning: () => running,
    isDraining: () => draining,
    dispose: () => {
      abort()
      clear()
    },
    get drainPromise() {
      return drainPromise
    },
  }
}
