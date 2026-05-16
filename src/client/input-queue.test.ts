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
  const queue = createInputQueue(async (item) => {
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
