import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { decodePeerInput, encodePeerInput } from "./peer-input"

describe("peer input encoding", () => {
  it("round-trips peer metadata and text", () => {
    const encoded = encodePeerInput("worker-a", 2, "please inspect this")

    assert.deepEqual(decodePeerInput(encoded), {
      text: "please inspect this",
      peerOrigin: "worker-a",
      peerHop: 2,
      samePairRoundtrips: 0,
      oneWay: false,
    })
  })

  it("supports peer names containing colons", () => {
    const encoded = encodePeerInput("team:worker:a", 3, "hello")

    assert.deepEqual(decodePeerInput(encoded), {
      text: "hello",
      peerOrigin: "team:worker:a",
      peerHop: 3,
      samePairRoundtrips: 0,
      oneWay: false,
    })
  })

  it("round-trips one-way, same-pair, and deep collaboration budget metadata", () => {
    const encoded = encodePeerInput("planner", 4, "decision log", {
      samePairRoundtrips: 2,
      oneWay: true,
      remainingPeerCalls: 7,
    })

    assert.deepEqual(decodePeerInput(encoded), {
      text: "decision log",
      peerOrigin: "planner",
      peerHop: 4,
      samePairRoundtrips: 2,
      oneWay: true,
      remainingPeerCalls: 7,
    })
  })

  it("decodes legacy peer metadata", () => {
    assert.deepEqual(decodePeerInput("\x01peer:worker-a:2\x01legacy"), {
      text: "legacy",
      peerOrigin: "worker-a",
      peerHop: 2,
    })
  })

  it("returns normal input unchanged", () => {
    assert.deepEqual(decodePeerInput("regular prompt"), { text: "regular prompt" })
  })

  it("keeps malformed peer input as plain text", () => {
    assert.deepEqual(decodePeerInput("\x01peer:worker:1 missing separator"), {
      text: "\x01peer:worker:1 missing separator",
    })
  })

  it("defaults invalid hop metadata to zero", () => {
    assert.deepEqual(decodePeerInput("\x01peer:worker:not-a-number\x01hi"), {
      text: "hi",
      peerOrigin: "worker",
      peerHop: 0,
    })
  })
})
