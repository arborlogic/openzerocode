import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { dirname, join } from "path"
import { createServer } from "http"

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
const OAUTH_PORT = 1455
const OAUTH_POLLING_SAFETY_MARGIN_MS = 3000

export type CodexAuth = {
  access: string
  refresh: string
  expires: number
  accountId?: string
}

type CodexCliAuthFile = {
  tokens?: {
    access_token?: string
    refresh_token?: string
    id_token?: string
    account_id?: string
  }
  last_refresh?: string
}

type OpenCodeAuthFile = Record<string, {
  type?: string
  access?: string
  refresh?: string
  expires?: number
  accountId?: string
  keyname?: string
}>

export type CodexAuthEntry = {
  label: string
  auth: CodexAuth
  tokenPreview: string
  isActive: boolean
  keyname?: string
}

const ACTIVE_MARKER = "_active"
const CODEX_KEY_PREFIX = "openai"

type TokenResponse = {
  id_token?: string
  access_token: string
  refresh_token?: string
  expires_in?: number
  account_id?: string
}

export type CodexDeviceAuthorization = {
  url: string
  userCode: string
  intervalMs: number
  waitForAuth: () => Promise<CodexAuth>
}

export type CodexBrowserAuthorization = {
  url: string
  redirectUri: string
  waitForAuth: () => Promise<CodexAuth>
  complete: (callbackUrlOrCode: string) => Promise<CodexAuth>
  cancel: () => void
}

type PkceCodes = {
  verifier: string
  challenge: string
}

type PendingOAuth = {
  pkce: PkceCodes
  state: string
  resolve: (tokens: TokenResponse) => void
  reject: (error: Error) => void
}

let oauthServer: ReturnType<typeof createServer> | undefined
let pendingOAuth: PendingOAuth | undefined

export function getCodexAuthPath() {
  return process.env.OPENZEROCODE_CODEX_AUTH_PATH || join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json")
}

export function getCodexAuthPathCandidates() {
  const override = process.env.OPENZEROCODE_CODEX_AUTH_PATH
  if (override) return [override]

  const candidates = [
    join(process.env.CODEX_HOME || join(homedir(), ".codex"), "auth.json"),
    join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "opencode", "auth.json"),
  ]
  return [...new Set(candidates)]
}

export function findCodexAuthPath() {
  return getCodexAuthPathCandidates().find((path) => readCodexAuthFile(path))
}

export function hasCodexAuth() {
  const auth = readCodexAuth()
  return Boolean(auth?.access && auth.refresh)
}

export function readCodexAuth(path?: string): CodexAuth | undefined {
  if (!path) {
    for (const candidate of getCodexAuthPathCandidates()) {
      const auth = readCodexAuthFile(candidate)
      if (auth) return auth
    }
    return undefined
  }
  return readCodexAuthFile(path)
}

function readCodexAuthFile(path: string): CodexAuth | undefined {
  try {
    if (!existsSync(path)) return undefined
    const raw = JSON.parse(readFileSync(path, "utf-8")) as CodexCliAuthFile & OpenCodeAuthFile

    const codexTokens = raw.tokens
    if (codexTokens?.access_token && codexTokens.refresh_token) {
      return {
        access: codexTokens.access_token,
        refresh: codexTokens.refresh_token,
        expires: tokenExpiry(codexTokens.access_token) ?? lastRefreshExpiry(raw.last_refresh),
        accountId: codexTokens.account_id,
      }
    }

    const openai = raw.openai
    if (openai?.type === "oauth" && openai.access && openai.refresh) {
      return {
        access: openai.access,
        refresh: openai.refresh,
        expires: openai.expires ?? tokenExpiry(openai.access) ?? 0,
        accountId: openai.accountId,
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

export async function resolveCodexAuth(path = findCodexAuthPath() ?? getCodexAuthPath()): Promise<CodexAuth> {
  const auth = readCodexAuth(path)
  if (!auth) throw new Error(`Missing Codex auth. Run Codex login first, or set OPENZEROCODE_CODEX_AUTH_PATH to an auth.json file.`)
  if (auth.expires > Date.now() + 60_000) return auth

  const tokens = await refreshAccessToken(auth.refresh)
  const next: CodexAuth = {
    access: tokens.access_token,
    refresh: tokens.refresh_token ?? auth.refresh,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    accountId: tokens.account_id ?? extractAccountId(tokens.id_token) ?? extractAccountId(tokens.access_token) ?? auth.accountId,
  }
  writeRefreshedCodexAuth(path, next)
  return next
}

function authFileLabel(auth: CodexAuth): string {
  if (auth.accountId && auth.accountId.length >= 4) {
    return `${CODEX_KEY_PREFIX}@${auth.accountId}`
  }
  const prefix = auth.access.slice(-8)
  return `${CODEX_KEY_PREFIX}@key_${prefix}`
}

function tokenPreview(access: string): string {
  if (access.length <= 12) return access
  return `${access.slice(0, 4)}...${access.slice(-4)}`
}

function readRawAuthFile(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {}
    return JSON.parse(readFileSync(path, "utf-8"))
  } catch {
    return {}
  }
}

/** Return all stored Codex auth entries with labels. */
export function listCodexAuths(path?: string): CodexAuthEntry[] {
  const authPath = path ?? findCodexAuthPath() ?? getCodexAuthPath()
  const raw = readRawAuthFile(authPath) as Record<string, unknown>
  const openaiFile = raw as OpenCodeAuthFile
  const activeLabel = (raw[ACTIVE_MARKER] as string) ?? CODEX_KEY_PREFIX
  const entries: CodexAuthEntry[] = []

  for (const [key, value] of Object.entries(openaiFile)) {
    if (key === ACTIVE_MARKER || key === "tokens" || key === "last_refresh" || key === CODEX_KEY_PREFIX) continue
    if (!key.startsWith(`${CODEX_KEY_PREFIX}@`)) continue
    if (!value || typeof value !== "object" || value.type !== "oauth" || !value.access || !value.refresh) continue
    const label = key
    const auth: CodexAuth = {
      access: value.access,
      refresh: value.refresh,
      expires: value.expires ?? tokenExpiry(value.access) ?? 0,
      accountId: value.accountId,
    }
    entries.push({
      label,
      auth,
      tokenPreview: tokenPreview(value.access),
      isActive: label === activeLabel,
      keyname: value.keyname,
    })
  }

  if (entries.length === 0) {
    const openai = openaiFile[CODEX_KEY_PREFIX]
    if (openai?.type === "oauth" && openai.access && openai.refresh) {
      entries.push({
        label: CODEX_KEY_PREFIX,
        auth: {
          access: openai.access,
          refresh: openai.refresh,
          expires: openai.expires ?? tokenExpiry(openai.access) ?? 0,
          accountId: openai.accountId,
        },
        tokenPreview: tokenPreview(openai.access),
        isActive: true,
        keyname: openai.keyname,
      })
    }
  }

  const rawAny = raw as any
  if (entries.length === 0 && rawAny.tokens?.access_token && rawAny.tokens?.refresh_token) {
    entries.push({
      label: `${CODEX_KEY_PREFIX}@legacy`,
      auth: {
        access: rawAny.tokens.access_token,
        refresh: rawAny.tokens.refresh_token,
        expires: tokenExpiry(rawAny.tokens.access_token) ?? lastRefreshExpiry(rawAny.last_refresh) ?? 0,
        accountId: rawAny.tokens.account_id,
      },
      tokenPreview: tokenPreview(rawAny.tokens.access_token),
      isActive: true,
    })
  }

  return entries
}

/** Activate a specific Codex auth entry by copying it to the default key. */
export function activateCodexAuth(label: string, path?: string): boolean {
  const authPath = path ?? findCodexAuthPath() ?? getCodexAuthPath()
  const raw = readRawAuthFile(authPath)
  const openaiFile = raw as OpenCodeAuthFile
  const entry = openaiFile[label]
  if (!entry?.access || !entry?.refresh) return false

  openaiFile[CODEX_KEY_PREFIX] = { ...entry }
  raw[ACTIVE_MARKER] = label
  writeFileSync(authPath, JSON.stringify(raw, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 })
  return true
}

/** Delete a named Codex auth entry. */
export function deleteCodexAuth(label: string, path?: string): boolean {
  const authPath = path ?? findCodexAuthPath() ?? getCodexAuthPath()
  const raw = readRawAuthFile(authPath) as Record<string, unknown>
  const openaiFile = raw as OpenCodeAuthFile

  const clearLegacyTokens = () => {
    const rawAny = raw as any
    delete rawAny.tokens
    delete raw["last_refresh"]
  }

  if (label === CODEX_KEY_PREFIX) {
    delete openaiFile[CODEX_KEY_PREFIX]
    delete raw[ACTIVE_MARKER]
    clearLegacyTokens()
    writeFileSync(authPath, JSON.stringify(raw, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 })
    return true
  }

  // Handle synthetic label used when only the legacy tokens section exists
  if (label === `${CODEX_KEY_PREFIX}@legacy`) {
    const rawAny = raw as any
    if (!rawAny.tokens?.access_token) return false
    clearLegacyTokens()
    delete openaiFile[CODEX_KEY_PREFIX]
    delete raw[ACTIVE_MARKER]
    writeFileSync(authPath, JSON.stringify(raw, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 })
    return true
  }

  if (!(label in raw)) return false
  const wasActive = raw[ACTIVE_MARKER] === label
  delete raw[label]

  if (wasActive) {
    const remainingNamed = Object.entries(openaiFile)
      .filter(([key, value]) => key.startsWith(`${CODEX_KEY_PREFIX}@`) && value && typeof value === "object")
      .map(([key]) => key)

    if (remainingNamed.length > 0) {
      const nextLabel = remainingNamed[0]!
      const next = openaiFile[nextLabel]
      if (next) {
        openaiFile[CODEX_KEY_PREFIX] = { ...next }
        raw[ACTIVE_MARKER] = nextLabel
      }
    } else {
      delete openaiFile[CODEX_KEY_PREFIX]
      delete raw[ACTIVE_MARKER]
      // No credentials remain — clear legacy tokens to prevent phantom re-appearance
      clearLegacyTokens()
    }
  }

  writeFileSync(authPath, JSON.stringify(raw, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 })
  return true
}

/** Set or clear the display keyname for a named Codex auth entry. */
export function setCodexAuthKeyname(label: string, keyname: string, path?: string): boolean {
  const authPath = path ?? findCodexAuthPath() ?? getCodexAuthPath()
  const raw = readRawAuthFile(authPath) as Record<string, unknown>
  const openaiFile = raw as OpenCodeAuthFile

  const entry = openaiFile[label]
  if (!entry || typeof entry !== "object") return false

  if (keyname) {
    entry.keyname = keyname
  } else {
    delete entry.keyname
  }

  // Keep openai default key in sync if this is the active entry
  if (label !== CODEX_KEY_PREFIX && openaiFile[CODEX_KEY_PREFIX]) {
    const activeLabel = (raw[ACTIVE_MARKER] as string) ?? CODEX_KEY_PREFIX
    if (activeLabel === label) {
      if (keyname) {
        openaiFile[CODEX_KEY_PREFIX]!.keyname = keyname
      } else {
        delete openaiFile[CODEX_KEY_PREFIX]!.keyname
      }
    }
  }

  writeFileSync(authPath, JSON.stringify(raw, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 })
  return true
}

export async function startCodexDeviceAuthorization(path = getCodexAuthPath()): Promise<CodexDeviceAuthorization> {
  const deviceResponse = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "openzerocode/codex-auth",
    },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  })

  if (!deviceResponse.ok) {
    throw new Error(`Failed to initiate Codex device authorization: ${deviceResponse.status}`)
  }

  const deviceData = await deviceResponse.json() as {
    device_auth_id: string
    user_code: string
    interval: string
  }
  const intervalMs = Math.max(Number.parseInt(deviceData.interval) || 5, 1) * 1000

  return {
    url: `${ISSUER}/codex/device`,
    userCode: deviceData.user_code,
    intervalMs,
    waitForAuth: () => pollCodexDeviceAuthorization(deviceData, intervalMs, path),
  }
}

export async function startCodexBrowserAuthorization(path = getCodexAuthPath()): Promise<CodexBrowserAuthorization> {
  const { redirectUri } = await startOAuthServer()
  const pkce = await generatePKCE()
  const state = generateState()
  const url = buildAuthorizeUrl(redirectUri, pkce, state)
  const callback = waitForOAuthCallback(pkce, state)

  return {
    url,
    redirectUri,
    waitForAuth: async () => {
      try {
        const tokens = await callback
        const auth = authFromTokenResponse(tokens)
        writeCodexCliAuth(path, auth, tokens)
        return auth
      } finally {
        stopOAuthServer()
      }
    },
    complete: async (callbackUrlOrCode) => {
      const code = extractCallbackCode(callbackUrlOrCode)
      const stateFromInput = extractCallbackState(callbackUrlOrCode)
      if (stateFromInput && stateFromInput !== state) {
        throw new Error("Invalid OAuth state")
      }
      const tokens = await exchangeBrowserCodeForTokens(code, redirectUri, pkce)
      const auth = authFromTokenResponse(tokens)
      writeCodexCliAuth(path, auth, tokens)
      pendingOAuth?.resolve(tokens)
      pendingOAuth = undefined
      stopOAuthServer()
      return auth
    },
    cancel: () => {
      pendingOAuth?.reject(new Error("Login cancelled"))
      pendingOAuth = undefined
      stopOAuthServer()
    },
  }
}

async function pollCodexDeviceAuthorization(
  deviceData: { device_auth_id: string; user_code: string },
  intervalMs: number,
  path: string,
): Promise<CodexAuth> {
  while (true) {
    const response = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "openzerocode/codex-auth",
      },
      body: JSON.stringify({
        device_auth_id: deviceData.device_auth_id,
        user_code: deviceData.user_code,
      }),
    })

    if (response.ok) {
      const data = await response.json() as {
        authorization_code: string
        code_verifier: string
      }

      const tokenResponse = await exchangeDeviceCodeForTokens(data.authorization_code, data.code_verifier)
      const auth = authFromTokenResponse(tokenResponse)
      writeCodexCliAuth(path, auth, tokenResponse)
      return auth
    }

    if (response.status !== 403 && response.status !== 404) {
      throw new Error(`Codex device authorization failed: ${response.status}`)
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs + OAUTH_POLLING_SAFETY_MARGIN_MS))
  }
}

function writeRefreshedCodexAuth(path: string, auth: CodexAuth) {
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>
    const openaiFile = raw as OpenCodeAuthFile

    // Update legacy tokens
    const cliFile = raw as CodexCliAuthFile
    if (cliFile.tokens) {
      cliFile.tokens.access_token = auth.access
      cliFile.tokens.refresh_token = auth.refresh
      if (auth.accountId) cliFile.tokens.account_id = auth.accountId
      cliFile.last_refresh = new Date().toISOString()
    }

    // Update openai default key
    if (openaiFile[CODEX_KEY_PREFIX]?.type === "oauth") {
      openaiFile[CODEX_KEY_PREFIX].access = auth.access
      openaiFile[CODEX_KEY_PREFIX].refresh = auth.refresh
      openaiFile[CODEX_KEY_PREFIX].expires = auth.expires
      if (auth.accountId) openaiFile[CODEX_KEY_PREFIX].accountId = auth.accountId
    }

    // Also update the named entry if it exists
    const activeLabel = (raw[ACTIVE_MARKER] as string) ?? CODEX_KEY_PREFIX
    if (activeLabel !== CODEX_KEY_PREFIX && openaiFile[activeLabel]?.type === "oauth") {
      openaiFile[activeLabel].access = auth.access
      openaiFile[activeLabel].refresh = auth.refresh
      openaiFile[activeLabel].expires = auth.expires
      if (auth.accountId) openaiFile[activeLabel].accountId = auth.accountId
    }
    writeFileSync(path, JSON.stringify(raw, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 })
  } catch {
    // Refresh still succeeded; failing to persist should not discard the usable token.
  }
}

async function startOAuthServer(): Promise<{ redirectUri: string }> {
  if (oauthServer) return { redirectUri: `http://localhost:${OAUTH_PORT}/auth/callback` }

  oauthServer = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${OAUTH_PORT}`)

    if (url.pathname === "/auth/callback") {
      const code = url.searchParams.get("code")
      const state = url.searchParams.get("state")
      const error = url.searchParams.get("error")
      const errorDescription = url.searchParams.get("error_description")

      if (error) {
        const message = errorDescription || error
        pendingOAuth?.reject(new Error(message))
        pendingOAuth = undefined
        res.writeHead(200, { "Content-Type": "text/html" })
        res.end(htmlError(message))
        return
      }

      if (!code) {
        pendingOAuth?.reject(new Error("Missing authorization code"))
        pendingOAuth = undefined
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end(htmlError("Missing authorization code"))
        return
      }

      if (!pendingOAuth || state !== pendingOAuth.state) {
        pendingOAuth?.reject(new Error("Invalid OAuth state"))
        pendingOAuth = undefined
        res.writeHead(400, { "Content-Type": "text/html" })
        res.end(htmlError("Invalid OAuth state"))
        return
      }

      const current = pendingOAuth
      pendingOAuth = undefined
      exchangeBrowserCodeForTokens(code, `http://localhost:${OAUTH_PORT}/auth/callback`, current.pkce)
        .then((tokens) => current.resolve(tokens))
        .catch((err) => current.reject(err instanceof Error ? err : new Error(String(err))))

      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(htmlSuccess())
      return
    }

    if (url.pathname === "/cancel") {
      pendingOAuth?.reject(new Error("Login cancelled"))
      pendingOAuth = undefined
      res.writeHead(200)
      res.end("Login cancelled")
      return
    }

    res.writeHead(404)
    res.end("Not found")
  })

  await new Promise<void>((resolve, reject) => {
    oauthServer!.listen(OAUTH_PORT, () => resolve())
    oauthServer!.on("error", reject)
  })
  return { redirectUri: `http://localhost:${OAUTH_PORT}/auth/callback` }
}

function stopOAuthServer() {
  if (!oauthServer) return
  oauthServer.close()
  oauthServer = undefined
}

function waitForOAuthCallback(pkce: PkceCodes, state: string): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (!pendingOAuth) return
      pendingOAuth = undefined
      reject(new Error("OAuth callback timeout"))
      stopOAuthServer()
    }, 5 * 60 * 1000)

    pendingOAuth = {
      pkce,
      state,
      resolve: (tokens) => {
        clearTimeout(timeout)
        resolve(tokens)
      },
      reject: (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    }
  })
}

async function refreshAccessToken(refreshToken: string): Promise<{
  id_token?: string
  access_token: string
  refresh_token?: string
  expires_in?: number
  account_id?: string
}> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(`Codex token refresh failed: ${response.status}`)
  }
  return response.json() as Promise<{
    id_token?: string
    access_token: string
    refresh_token?: string
    expires_in?: number
    account_id?: string
  }>
}

async function exchangeDeviceCodeForTokens(code: string, codeVerifier: string): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${ISSUER}/deviceauth/callback`,
      client_id: CLIENT_ID,
      code_verifier: codeVerifier,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(`Codex token exchange failed: ${response.status}`)
  }
  return response.json() as Promise<TokenResponse>
}

async function exchangeBrowserCodeForTokens(code: string, redirectUri: string, pkce: PkceCodes): Promise<TokenResponse> {
  const response = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  })
  if (!response.ok) {
    throw new Error(`Codex token exchange failed: ${response.status}`)
  }
  return response.json() as Promise<TokenResponse>
}

function authFromTokenResponse(tokens: TokenResponse): CodexAuth {
  return {
    access: tokens.access_token,
    refresh: tokens.refresh_token ?? "",
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    accountId: tokens.account_id ?? extractAccountId(tokens.id_token) ?? extractAccountId(tokens.access_token),
  }
}

function writeCodexCliAuth(path: string, auth: CodexAuth, tokens?: TokenResponse) {
  mkdirSync(dirname(path), { recursive: true })
  let raw: Record<string, unknown> = {}
  try {
    raw = JSON.parse(readFileSync(path, "utf-8"))
  } catch {}

  // Update legacy tokens format
  const cliFile = raw as CodexCliAuthFile
  cliFile.tokens = {
    ...(cliFile.tokens ?? {}),
    access_token: auth.access,
    refresh_token: auth.refresh,
    id_token: tokens?.id_token ?? cliFile.tokens?.id_token,
    account_id: auth.accountId,
  }
  cliFile.last_refresh = new Date().toISOString()

  // Also store as openai-format entry under a named label
  const openaiFile = raw as OpenCodeAuthFile
  const label = authFileLabel(auth)
  openaiFile[label] = {
    ...openaiFile[label],  // preserve existing fields (e.g. keyname)
    type: "oauth",
    access: auth.access,
    refresh: auth.refresh,
    expires: auth.expires,
    accountId: auth.accountId,
  }
  // Keep the default key in sync (preserve keyname there too)
  openaiFile[CODEX_KEY_PREFIX] = { ...openaiFile[CODEX_KEY_PREFIX], ...openaiFile[label]! }
  raw[ACTIVE_MARKER] = label

  writeFileSync(path, JSON.stringify(raw, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 })
}

function lastRefreshExpiry(value: string | undefined) {
  const last = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(last) ? last + 55 * 60_000 : 0
}

function tokenExpiry(token: string) {
  const parts = token.split(".")
  if (parts.length !== 3) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString()) as { exp?: number }
    return typeof payload.exp === "number" ? payload.exp * 1000 : undefined
  } catch {
    return undefined
  }
}

function extractAccountId(token: string | undefined) {
  if (!token) return undefined
  const parts = token.split(".")
  if (parts.length !== 3) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString()) as {
      chatgpt_account_id?: string
      organizations?: Array<{ id?: string }>
      "https://api.openai.com/auth"?: { chatgpt_account_id?: string }
    }
    return (
      payload.chatgpt_account_id ||
      payload["https://api.openai.com/auth"]?.chatgpt_account_id ||
      payload.organizations?.[0]?.id
    )
  } catch {
    return undefined
  }
}

export function extractCallbackCode(input: string) {
  const trimmed = input.trim()
  if (!trimmed) throw new Error("Missing authorization code")
  try {
    const url = new URL(trimmed)
    const code = url.searchParams.get("code")
    if (!code) throw new Error("Missing code in callback URL")
    return code
  } catch (error) {
    if (/^https?:\/\//.test(trimmed)) throw error
    return trimmed
  }
}

export function extractCallbackState(input: string) {
  try {
    return new URL(input.trim()).searchParams.get("state") ?? undefined
  } catch {
    return undefined
  }
}

/** Check if an input string looks like an OAuth callback URL or authorization code. */
export function isOAuthCallbackUrl(input: string): boolean {
  const trimmed = input.trim()
  if (!trimmed) return false
  try {
    const url = new URL(trimmed)
    return url.pathname === "/auth/callback" && url.searchParams.has("code")
  } catch {
    // Not a valid URL — maybe a raw code (20+ alphanumeric/extended chars)
    return /^[a-zA-Z0-9._~-]{20,}$/.test(trimmed)
  }
}

async function generatePKCE(): Promise<PkceCodes> {
  const verifier = generateRandomString(43)
  const data = new TextEncoder().encode(verifier)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return { verifier, challenge: base64UrlEncode(hash) }
}

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes).map((byte) => chars[byte % chars.length]).join("")
}

function generateState() {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

function base64UrlEncode(buffer: ArrayBuffer) {
  return Buffer.from(buffer).toString("base64url")
}

function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "opencode",
  })
  return `${ISSUER}/oauth/authorize?${params.toString()}`
}

function htmlSuccess() {
  return "<!doctype html><title>OpenZeroCode - Codex Authorization Successful</title><h1>Authorization Successful</h1><p>You can close this window and return to OpenZeroCode.</p><script>setTimeout(() => window.close(), 2000)</script>"
}

function htmlError(error: string) {
  const escaped = error.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!)
  return `<!doctype html><title>OpenZeroCode - Codex Authorization Failed</title><h1>Authorization Failed</h1><p>${escaped}</p>`
}
