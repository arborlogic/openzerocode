import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { dirname, join } from "path"

const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const ISSUER = "https://auth.openai.com"
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
}>

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
    const raw = JSON.parse(readFileSync(path, "utf-8")) as CodexCliAuthFile & OpenCodeAuthFile
    if (raw.tokens) {
      raw.tokens.access_token = auth.access
      raw.tokens.refresh_token = auth.refresh
      if (auth.accountId) raw.tokens.account_id = auth.accountId
      raw.last_refresh = new Date().toISOString()
    } else if (raw.openai?.type === "oauth") {
      raw.openai.access = auth.access
      raw.openai.refresh = auth.refresh
      raw.openai.expires = auth.expires
      if (auth.accountId) raw.openai.accountId = auth.accountId
    }
    writeFileSync(path, JSON.stringify(raw, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 })
  } catch {
    // Refresh still succeeded; failing to persist should not discard the usable token.
  }
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
  let raw: CodexCliAuthFile = {}
  try {
    raw = JSON.parse(readFileSync(path, "utf-8")) as CodexCliAuthFile
  } catch {}
  raw.tokens = {
    ...(raw.tokens ?? {}),
    access_token: auth.access,
    refresh_token: auth.refresh,
    id_token: tokens?.id_token ?? raw.tokens?.id_token,
    account_id: auth.accountId,
  }
  raw.last_refresh = new Date().toISOString()
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
