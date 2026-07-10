import { afterEach, beforeEach, describe, it } from "node:test"
import assert from "node:assert"
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  __resetXaiDiscoveryCacheForTests,
  deleteXaiAuth,
  getXaiAuthPath,
  hasXaiAuth,
  readXaiAuth,
} from "./xai-auth"

let tempDir = ""
let tempFile = ""
let previousPath: string | undefined
let previousHermesHome: string | undefined

describe("xai auth", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "openzerocode-xai-auth-"))
    tempFile = join(tempDir, "xai-auth.json")
    previousPath = process.env.OPENZEROCODE_XAI_AUTH_PATH
    previousHermesHome = process.env.HERMES_HOME
    process.env.OPENZEROCODE_XAI_AUTH_PATH = tempFile
    delete process.env.HERMES_HOME
    __resetXaiDiscoveryCacheForTests()
  })

  afterEach(() => {
    if (previousPath === undefined) delete process.env.OPENZEROCODE_XAI_AUTH_PATH
    else process.env.OPENZEROCODE_XAI_AUTH_PATH = previousPath
    if (previousHermesHome === undefined) delete process.env.HERMES_HOME
    else process.env.HERMES_HOME = previousHermesHome
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
    __resetXaiDiscoveryCacheForTests()
  })

  it("uses the configured auth path override", () => {
    assert.equal(getXaiAuthPath(), tempFile)
  })

  it("reads native xAI OAuth tokens", () => {
    writeFileSync(tempFile, JSON.stringify({
      tokens: {
        access_token: "access-token",
        refresh_token: "refresh-token",
      },
      last_refresh: "2026-07-10T00:00:00.000Z",
      base_url: "https://api.x.ai/v1",
    }), "utf-8")

    const auth = readXaiAuth()
    assert.equal(auth?.access, "access-token")
    assert.equal(auth?.refresh, "refresh-token")
    assert.equal(auth?.baseURL, "https://api.x.ai/v1")
    assert.equal(hasXaiAuth(), true)
  })

  it("reads Hermes providers.xai-oauth tokens", () => {
    writeFileSync(tempFile, JSON.stringify({
      providers: {
        "xai-oauth": {
          tokens: {
            access_token: "hermes-access",
            refresh_token: "hermes-refresh",
          },
          last_refresh: "2026-07-10T00:00:00.000Z",
          discovery: {
            token_endpoint: "https://auth.x.ai/oauth2/token",
          },
        },
      },
    }), "utf-8")

    const auth = readXaiAuth()
    assert.equal(auth?.access, "hermes-access")
    assert.equal(auth?.refresh, "hermes-refresh")
    assert.equal(auth?.tokenEndpoint, "https://auth.x.ai/oauth2/token")
  })

  it("deleteXaiAuth clears native credentials", () => {
    writeFileSync(tempFile, JSON.stringify({
      tokens: {
        access_token: "access-token",
        refresh_token: "refresh-token",
      },
      last_refresh: "2026-07-10T00:00:00.000Z",
    }), "utf-8")

    assert.equal(deleteXaiAuth(tempFile), true)
    assert.equal(hasXaiAuth(), false)
    const raw = JSON.parse(readFileSync(tempFile, "utf-8"))
    assert.equal(raw.tokens, undefined)
  })
})
