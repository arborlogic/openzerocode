import test from "node:test"
import assert from "node:assert/strict"
import { createInputQueue } from "./input-queue"

test("input queue runs prompts serially in order", async () => {
  const events: string[] = []
  const queue = createInputQueue(async (item) => {
    events.push(`start:${item.text}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
    events.push(`end:${item.text}`)
  })

  queue.enqueue("one")
  queue.enqueue("two")
  await queue.drainPromise

  assert.deepEqual(events, [
    "start:one",
    "end:one",
    "start:two",
    "end:two",
  ])
})

test("input queue abort cancels current item and clears pending items", async () => {
  const events: string[] = []
  const queue = createInputQueue(async (item, signal) => {
    events.push(`start:${item.text}`)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, item.text === "one" ? 50 : 5)
      signal.addEventListener("abort", () => {
        clearTimeout(timer)
        reject(new DOMException("aborted", "AbortError"))
      }, { once: true })
    })
    events.push(`end:${item.text}`)
  })

  queue.enqueue("one")
  queue.enqueue("two")
  setTimeout(() => queue.abort(), 10)
  await queue.drainPromise

  // "two" should never start because abort clears the queue
  assert.deepEqual(events, [
    "start:one",
  ])
})

test("input queue depth excludes running item", async () => {
  const queue = createInputQueue(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })

  assert.equal(queue.depth(), 0, "empty queue depth is 0")

  queue.enqueue("one")
  // "one" starts running immediately, so depth should be 0 (nothing waiting)
  assert.equal(queue.depth(), 0, "depth is 0 when one item is running")

  queue.enqueue("two")
  // "one" is running, "two" is waiting
  assert.equal(queue.depth(), 1, "depth is 1 when one is running and one is waiting")

  await queue.drainPromise
  assert.equal(queue.depth(), 0, "depth is 0 after drain")
})

test("pendingItems exposes waiting items and cancel removes one queued item", async () => {
  const started: string[] = []
  let releaseFirst!: () => void
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })

  const queue = createInputQueue(async (item) => {
    started.push(item.text)
    if (item.text === "one") await firstGate
  })

  const oneId = queue.enqueue("one")
  const twoId = queue.enqueue("two")
  const threeId = queue.enqueue("three")

  assert.equal(queue.depth(), 2)
  assert.deepEqual(queue.pendingItems().map((item) => item.id), [twoId, threeId])
  assert.ok(!queue.pendingItems().some((item) => item.id === oneId), "running item is not pending")

  assert.equal(queue.cancel(twoId), true)
  assert.equal(queue.depth(), 1)
  assert.deepEqual(queue.pendingItems().map((item) => item.text), ["three"])
  assert.equal(queue.cancel(twoId), false, "already cancelled item cannot be cancelled twice")

  releaseFirst()
  await queue.drainPromise

  assert.deepEqual(started, ["one", "three"])
  assert.equal(queue.depth(), 0)
  assert.deepEqual(queue.pendingItems(), [])
})

test("cancel refuses running item", async () => {
  let releaseFirst!: () => void
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })

  const queue = createInputQueue(async (item) => {
    if (item.text === "one") await firstGate
  })

  const oneId = queue.enqueue("one")
  queue.enqueue("two")

  assert.equal(queue.cancel(oneId), false)
  assert.equal(queue.depth(), 1)

  releaseFirst()
  await queue.drainPromise
})
