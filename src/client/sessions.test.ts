import { beforeEach, afterEach, describe, it } from "node:test"
import assert from "node:assert"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import type { Message } from "../provider/types"

// Since sessions.ts now uses getSessionDir() (lazy), we can set HOME before any import.
// For safety, we set it here at module scope. Each test's beforeEach sets a unique temp dir.
const ORIG_HOME = process.env.HOME
let tempHome = ""

import {
  generateId,
  listSessions,
  getCurrentSessionId,
  setCurrentSessionId,
  createSession,
  saveSession,
  loadSession,
  loadSessionState,
  deleteSession,
  currentSessionMeta,
  updateSessionMeta,
} from "./sessions"

describe("sessions", () => {
  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "ozc-sessions-test-"))
    process.env.HOME = tempHome
  })

  afterEach(() => {
    process.env.HOME = ORIG_HOME
    if (tempHome) {
      rmSync(tempHome, { recursive: true, force: true })
      tempHome = ""
    }
  })

  describe("generateId", () => {
    it("generates a unique id starting with ses_", () => {
      const id = generateId()
      assert.ok(id.startsWith("ses_"))
    })

    it("generates unique ids", () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()))
      assert.equal(ids.size, 100)
    })
  })

  describe("createSession", () => {
    it("creates a session and sets it as current", () => {
      const meta = createSession("gpt-4o", "openai")
      assert.ok(meta.id)
      assert.equal(meta.model, "gpt-4o")
      assert.equal(meta.provider, "openai")
      assert.equal(meta.messageCount, 0)
      assert.equal(getCurrentSessionId(), meta.id)
    })

    it("saves provided messages to session file", () => {
      const msgs: Message[] = [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi" },
      ]
      const meta = createSession("gpt-4o", "openai", msgs)
      const sessionDir = join(tempHome, ".openzerocode", "sessions")
      const sessionFile = join(sessionDir, `${meta.id}.json`)
      assert.ok(existsSync(sessionFile))
      const saved = JSON.parse(readFileSync(sessionFile, "utf-8"))
      assert.equal(saved.messages.length, 2)
    })
  })

  describe("saveSession and loadSession", () => {
    it("saves and loads session messages", () => {
      const meta = createSession("gpt-4o", "openai")
      const msgs: Message[] = [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "World" },
      ]
      saveSession(meta.id, msgs, "gpt-4o", "openai")
      const loaded = loadSession(meta.id)
      assert.ok(loaded)
      assert.equal(loaded.length, 2)
      assert.equal(loaded[1]?.content, "World")
    })

    it("loadSession returns null for nonexistent session", () => {
      const result = loadSession("nonexistent_id")
      assert.equal(result, null)
    })

    it("loadSessionState returns full state", () => {
      const meta = createSession("gpt-4o", "openai")
      const msgs: Message[] = [{ role: "user", content: "test" }]
      saveSession(meta.id, msgs, "gpt-4o", "openai", "build", undefined, [], true)
      const state = loadSessionState(meta.id)
      assert.ok(state)
      assert.equal(state?.messages.length, 1)
      assert.equal(state?.model, "gpt-4o")
      assert.equal(state?.mode, "build")
      assert.equal(state?.autoApprove, true)
    })

    it("loadSessionState returns null for nonexistent session", () => {
      assert.equal(loadSessionState("nonexistent"), null)
    })
  })

  describe("deleteSession", () => {
    it("deletes a session", () => {
      const meta = createSession("gpt-4o", "openai", [{ role: "user", content: "test" }])
      const sessionDir = join(tempHome, ".openzerocode", "sessions")
      const sessionFile = join(sessionDir, `${meta.id}.json`)
      assert.ok(existsSync(sessionFile))
      const result = deleteSession(meta.id)
      assert.ok(result)
      assert.ok(!existsSync(sessionFile))
    })

    it("returns false for nonexistent session", () => {
      assert.ok(!deleteSession("nonexistent"))
    })

    it("resets current when deleting current session", () => {
      const meta = createSession("gpt-4o", "openai")
      assert.equal(getCurrentSessionId(), meta.id)
      const result = deleteSession(meta.id)
      assert.ok(result)
      assert.notEqual(getCurrentSessionId(), meta.id)
    })
  })

  describe("currentSessionMeta", () => {
    it("returns current session metadata", () => {
      const meta = createSession("gpt-4o", "openai")
      const current = currentSessionMeta()
      assert.ok(current)
      assert.equal(current?.id, meta.id)
    })

    it("returns null when no current session", () => {
      setCurrentSessionId(null)
      assert.equal(currentSessionMeta(), null)
    })
  })

  describe("listSessions", () => {
    it("lists sessions sorted by updatedAt descending", async () => {
      const meta1 = createSession("gpt-4o", "openai")
      await new Promise((r) => setTimeout(r, 10))
      const meta2 = createSession("claude", "anthropic")
      const all = listSessions()
      assert.equal(all.length, 2)
      assert.equal(all[0]?.id, meta2.id)
      assert.equal(all[1]?.id, meta1.id)
    })
  })

  describe("updateSessionMeta", () => {
    it("updates session title", () => {
      const meta = createSession("gpt-4o", "openai")
      updateSessionMeta(meta.id, { title: "New Title" })
      const updated = currentSessionMeta()
      assert.equal(updated?.title, "New Title")
    })
  })
})
