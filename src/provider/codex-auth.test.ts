import { afterEach, beforeEach, describe, it } from "node:test"
import assert from "node:assert"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { readFileSync } from "fs"
import { deleteCodexAuth, findCodexAuthPath, getCodexAuthPath, getCodexAuthPathCandidates, hasCodexAuth, listCodexAuths, readCodexAuth } from "./codex-auth"

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

  it("deleteCodexAuth removes named openai@ entry and clears tokens when last", () => {
    const authData = {
      tokens: { access_token: "access-1", refresh_token: "refresh-1", account_id: "acct-1" },
      last_refresh: "2026-05-15T00:00:00.000Z",
      "openai": { type: "oauth", access: "access-1", refresh: "refresh-1", expires: 9999 },
      "openai@acct-1": { type: "oauth", access: "access-1", refresh: "refresh-1", expires: 9999, accountId: "acct-1" },
      "_active": "openai@acct-1",
    }
    writeFileSync(tempFile, JSON.stringify(authData), "utf-8")

    const ok = deleteCodexAuth("openai@acct-1")
    assert.equal(ok, true)
    const remaining = JSON.parse(readFileSync(tempFile, "utf-8"))
    assert.equal(remaining["openai@acct-1"], undefined)
    assert.equal(remaining["openai"], undefined)
    assert.equal(remaining["_active"], undefined)
    assert.equal(remaining["tokens"], undefined, "legacy tokens should be cleared when no entries remain")
    assert.equal(remaining["last_refresh"], undefined)
  })

  it("deleteCodexAuth removes legacy tokens-only entry via synthetic label", () => {
    const authData = {
      tokens: { access_token: "access-1", refresh_token: "refresh-1" },
      last_refresh: "2026-05-15T00:00:00.000Z",
    }
    writeFileSync(tempFile, JSON.stringify(authData), "utf-8")

    const entries = listCodexAuths()
    assert.equal(entries.length, 1)
    assert.equal(entries[0]!.label, "openai@legacy")

    const ok = deleteCodexAuth("openai@legacy")
    assert.equal(ok, true)
    const remaining = JSON.parse(readFileSync(tempFile, "utf-8"))
    assert.equal(remaining["tokens"], undefined)
    assert.equal(remaining["last_refresh"], undefined)
    assert.equal(listCodexAuths().length, 0, "no entries after legacy deletion")
  })

  it("deleteCodexAuth keeps tokens when other named entries remain", () => {
    const authData = {
      tokens: { access_token: "access-2", refresh_token: "refresh-2" },
      "openai": { type: "oauth", access: "access-2", refresh: "refresh-2", expires: 9999 },
      "openai@acct-1": { type: "oauth", access: "access-1", refresh: "refresh-1", expires: 9999 },
      "openai@acct-2": { type: "oauth", access: "access-2", refresh: "refresh-2", expires: 9999 },
      "_active": "openai@acct-2",
    }
    writeFileSync(tempFile, JSON.stringify(authData), "utf-8")

    const ok = deleteCodexAuth("openai@acct-2")
    assert.equal(ok, true)
    const remaining = JSON.parse(readFileSync(tempFile, "utf-8"))
    assert.equal(remaining["openai@acct-2"], undefined)
    assert.notEqual(remaining["tokens"], undefined, "tokens kept since another entry remains")
    assert.equal(remaining["_active"], "openai@acct-1", "active switched to remaining entry")
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
