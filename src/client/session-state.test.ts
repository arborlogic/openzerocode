import { beforeEach, afterEach, describe, it } from "node:test"
import assert from "node:assert"
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { Message, ToolCall } from "../provider/types"

const ORIG_HOME = process.env.HOME
let tempHome = ""

// Import after HOME is set (module reads HOME lazily now via getSessionDir/getSessionFile)
process.env.HOME = tmpdir() // temporary placeholder — each test resets it before importing
import { loadSession, saveSession, migrateMessage, getSessionDir, getSessionFile } from "./session-state"

function withHome(homeDir: string, fn: () => void) {
  process.env.HOME = homeDir
  try { fn() } finally { process.env.HOME = ORIG_HOME }
}

describe("getSessionDir / getSessionFile", () => {
  it("returns paths under HOME", () => {
    withHome("/tmp/test-home", () => {
      assert.ok(getSessionDir().startsWith("/tmp/test-home"))
      assert.ok(getSessionFile().startsWith("/tmp/test-home"))
    })
  })
})

describe("migrateMessage", () => {
  it("passes through messages with existing parts", () => {
    const msg: Message = { role: "user", content: "hi", parts: [{ type: "text", text: "hi" }] }
    assert.equal(migrateMessage(msg), msg)
  })

  it("migrates assistant message with content", () => {
    const msg: Message = { role: "assistant", content: "Hello" }
    const result = migrateMessage(msg)
    assert.deepEqual(result.parts, [{ type: "text", text: "Hello" }])
  })

  it("migrates assistant message with reasoning", () => {
    const msg: Message = { role: "assistant", content: "Answer", reasoning_content: "thinking..." }
    const result = migrateMessage(msg)
    assert.deepEqual(result.parts, [
      { type: "reasoning", text: "thinking..." },
      { type: "text", text: "Answer" },
    ])
  })

  it("migrates assistant message with tool calls", () => {
    const toolCalls: ToolCall[] = [
      { id: "call_1", type: "function", function: { name: "read", arguments: '{"path":"x"}' } },
    ]
    const msg: Message = { role: "assistant", content: "", tool_calls: toolCalls }
    const result = migrateMessage(msg)
    assert.deepEqual(result.parts, [
      { type: "tool-call", id: "call_1", tool: "read", input: '{"path":"x"}' },
    ])
  })

  it("migrates tool message", () => {
    const msg: Message = { role: "tool", tool_call_id: "call_1", content: "output" }
    const result = migrateMessage(msg)
    assert.deepEqual(result.parts, [
      { type: "tool-result", id: "call_1", output: "output" },
    ])
  })

  it("returns user message unchanged", () => {
    const msg: Message = { role: "user", content: "question" }
    assert.equal(migrateMessage(msg), msg)
  })

  it("returns system message unchanged", () => {
    const msg: Message = { role: "system", content: "instructions" }
    assert.equal(migrateMessage(msg), msg)
  })
})

describe("saveSession / loadSession", () => {
  let testHome: string

  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), "ozc-session-state-"))
    process.env.HOME = testHome
  })

  afterEach(() => {
    process.env.HOME = ORIG_HOME
    if (testHome) { rmSync(testHome, { recursive: true, force: true }); testHome = "" }
  })

  it("saves and loads messages", () => {
    const msgs: Message[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ]
    saveSession(msgs)
    assert.ok(existsSync(getSessionFile()))

    const loaded = loadSession()
    assert.equal(loaded.length, 2)
    assert.equal(loaded[1]?.content, "world")
  })

  it("loadSession returns empty array when no file exists", () => {
    assert.deepEqual(loadSession(), [])
  })

  it("loadSession migrates messages on load", () => {
    const msgs: Message[] = [
      { role: "assistant", content: "Hello", reasoning_content: "thinking..." },
    ]
    saveSession(msgs)
    const loaded = loadSession()
    assert.ok(loaded[0]?.parts)
    assert.equal(loaded[0]?.parts?.length, 2)
    assert.equal((loaded[0]?.parts as any[])[0]?.type, "reasoning")
  })

  it("loadSession handles corrupt JSON gracefully", () => {
    const dir = getSessionDir()
    const file = getSessionFile()
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, "not valid json", "utf-8")
    assert.deepEqual(loadSession(), [])
  })
})
