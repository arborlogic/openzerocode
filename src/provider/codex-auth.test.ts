import { afterEach, beforeEach, describe, it } from "node:test"
import assert from "node:assert"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { findCodexAuthPath, getCodexAuthPath, getCodexAuthPathCandidates, hasCodexAuth, readCodexAuth } from "./codex-auth"

let tempDir = ""
let tempFile = ""
let opencodeFile = ""
let previousPath: string | undefined
let previousCodeHome: string | undefined
let previousXdgDataHome: string | undefined

describe("codex auth", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openzerocode-codex-auth-"))
    tempFile = join(tempDir, "auth.json")
    opencodeFile = join(tempDir, "xdg-data", "opencode", "auth.json")
    previousPath = process.env.OPENZEROCODE_CODEX_AUTH_PATH
    previousCodeHome = process.env.CODEX_HOME
    previousXdgDataHome = process.env.XDG_DATA_HOME
    process.env.OPENZEROCODE_CODEX_AUTH_PATH = tempFile
  })

  afterEach(() => {
    if (previousPath === undefined) delete process.env.OPENZEROCODE_CODEX_AUTH_PATH
    else process.env.OPENZEROCODE_CODEX_AUTH_PATH = previousPath
    if (previousCodeHome === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = previousCodeHome
    if (previousXdgDataHome === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = previousXdgDataHome
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
  })

  it("uses the configured auth path override", () => {
    assert.equal(getCodexAuthPath(), tempFile)
  })

  it("reads Codex CLI auth tokens", () => {
    writeFileSync(tempFile, JSON.stringify({
      tokens: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        account_id: "account-123",
      },
      last_refresh: "2026-05-15T00:00:00.000Z",
    }), "utf-8")

    const auth = readCodexAuth()
    assert.equal(auth?.access, "access-token")
    assert.equal(auth?.refresh, "refresh-token")
    assert.equal(auth?.accountId, "account-123")
    assert.equal(hasCodexAuth(), true)
  })

  it("reads opencode oauth auth tokens", () => {
    writeFileSync(tempFile, JSON.stringify({
      openai: {
        type: "oauth",
        access: "access-token",
        refresh: "refresh-token",
        expires: 1234,
        accountId: "account-123",
      },
    }), "utf-8")

    const auth = readCodexAuth()
    assert.equal(auth?.access, "access-token")
    assert.equal(auth?.refresh, "refresh-token")
    assert.equal(auth?.expires, 1234)
    assert.equal(auth?.accountId, "account-123")
  })

  it("falls back to opencode's xdg data auth path", () => {
    delete process.env.OPENZEROCODE_CODEX_AUTH_PATH
    process.env.CODEX_HOME = join(tempDir, "missing-codex")
    process.env.XDG_DATA_HOME = join(tempDir, "xdg-data")
    mkdirSync(join(tempDir, "xdg-data", "opencode"), { recursive: true })
    writeFileSync(opencodeFile, JSON.stringify({
      openai: {
        type: "oauth",
        access: "access-token",
        refresh: "refresh-token",
        expires: 1234,
      },
    }), "utf-8")

    assert.deepEqual(getCodexAuthPathCandidates(), [
      join(tempDir, "missing-codex", "auth.json"),
      opencodeFile,
    ])
    assert.equal(findCodexAuthPath(), opencodeFile)
    assert.equal(readCodexAuth()?.access, "access-token")
  })
})
