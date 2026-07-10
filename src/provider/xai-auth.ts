import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { homedir } from "os"
import { dirname, join } from "path"

const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828"
const ISSUER = "https://auth.x.ai"
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`
const DEVICE_CODE_URL = `${ISSUER}/oauth2/device/code`
const SCOPE = "openid profile email offline_access grok-cli:access api:access"
const DEFAULT_BASE_URL = "https://api.x.ai/v1"
const ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 3600
const SHORT_TOKEN_REFRESH_SKEW_SECONDS = 120

export type XaiAuth = {
  access: string
  refresh: string
  expires: number
  tokenEndpoint?: string
  baseURL?: string
}

type StoredXaiAuthFile = {
  tokens?: {
    access_token?: string
    refresh_token?: string
    id_token?: string
    token_type?: string
    expires_in?: number
  }
  last_refresh?: string
  discovery?: {
    authorization_endpoint?: string
    token_endpoint?: string
  }
  base_url?: string
  auth_mode?: string
}

export type XaiDeviceAuthorization = {
  url: string
  userCode: string
  intervalMs: number
  waitForAuth: () => Promise<XaiAuth>
}

type Discovery = {
  authorization_endpoint: string
  token_endpoint: string
}

type DeviceCodeResponse = {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
  token_type?: string
}

let cachedDiscovery: Discovery | undefined

export function getXaiAuthPath() {
  return process.env.OPENZEROCODE_XAI_AUTH_PATH || join(homedir(), ".openzerocode", "xai-auth.json")
}

export function getXaiAuthPathCandidates() {
  const override = process.env.OPENZEROCODE_XAI_AUTH_PATH
  if (override) return [override]

  const candidates = [
    join(homedir(), ".openzerocode", "xai-auth.json"),
    join(process.env.HERMES_HOME || join(homedir(), ".hermes"), "auth.json"),
  ]
  return [...new Set(candidates)]
}

export function findXaiAuthPath() {
  return getXaiAuthPathCandidates().find((path) => readXaiAuthFile(path))
}

export function hasXaiAuth() {
  const auth = readXaiAuth()
  return Boolean(auth?.access && auth.refresh)
}

export function readXaiAuth(path?: string): XaiAuth | undefined {
  if (!path) {
    for (const candidate of getXaiAuthPathCandidates()) {
      const auth = readXaiAuthFile(candidate)
      if (auth) return auth
    }
    return undefined
  }
  return readXaiAuthFile(path)
}

function readXaiAuthFile(path: string): XaiAuth | undefined {
  try {
    if (!existsSync(path)) return undefined
    const raw = JSON.parse(readFileSync(path, "utf-8")) as StoredXaiAuthFile & {
      providers?: Record<string, any>
      xai?: any
    }

    // Hermes auth.json shape: providers["xai-oauth"].tokens
    const hermesState = raw.providers?.["xai-oauth"]
    if (hermesState?.tokens?.access_token && hermesState?.tokens?.refresh_token) {
      return {
        access: hermesState.tokens.access_token,
        refresh: hermesState.tokens.refresh_token,
        expires: tokenExpiry(hermesState.tokens.access_token) ?? lastRefreshExpiry(hermesState.last_refresh),
        tokenEndpoint: hermesState.discovery?.token_endpoint,
        baseURL: hermesState.base_url || raw.base_url,
      }
    }

    // OpenZeroCode native shape
    if (raw.tokens?.access_token && raw.tokens?.refresh_token) {
      return {
        access: raw.tokens.access_token,
        refresh: raw.tokens.refresh_token,
        expires: tokenExpiry(raw.tokens.access_token) ?? lastRefreshExpiry(raw.last_refresh),
        tokenEndpoint: raw.discovery?.token_endpoint,
        baseURL: raw.base_url,
      }
    }

    // Compact oauth entry
    if (raw.xai?.type === "oauth" && raw.xai.access && raw.xai.refresh) {
      return {
        access: raw.xai.access,
        refresh: raw.xai.refresh,
        expires: raw.xai.expires ?? tokenExpiry(raw.xai.access) ?? 0,
        tokenEndpoint: raw.xai.tokenEndpoint,
        baseURL: raw.xai.baseURL,
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

export function deleteXaiAuth(path = getXaiAuthPath()): boolean {
  try {
    if (!existsSync(path)) return false
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>
    // Only rewrite native openzerocode auth files; never wipe Hermes auth.json.
    if (path.endsWith("auth.json") && "providers" in raw && !path.includes(".openzerocode")) {
      return false
    }
    delete raw.tokens
    delete raw.last_refresh
    delete raw.discovery
    delete raw.base_url
    delete raw.auth_mode
    delete raw.xai
    writeFileSync(path, JSON.stringify(raw, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 })
    return true
  } catch {
    return false
  }
}

export async function resolveXaiAuth(path = findXaiAuthPath() ?? getXaiAuthPath()): Promise<XaiAuth> {
  const auth = readXaiAuth(path)
  if (!auth) {
    throw new Error("Missing xAI OAuth credentials. Run /xai-login first, or set OPENZEROCODE_XAI_AUTH_PATH.")
  }

  const skew = proactiveRefreshSkewSeconds(auth.access)
  if (auth.expires > Date.now() + skew * 1000) return auth

  const discovery = auth.tokenEndpoint
    ? { authorization_endpoint: "", token_endpoint: auth.tokenEndpoint }
    : await fetchXaiDiscovery()
  validateXaiOauthEndpoint(discovery.token_endpoint, "token_endpoint")

  const tokens = await refreshXaiAccessToken(auth.refresh, discovery.token_endpoint)
  const next: XaiAuth = {
    access: tokens.access_token,
    refresh: tokens.refresh_token ?? auth.refresh,
    expires: tokenExpiry(tokens.access_token) ?? Date.now() + (tokens.expires_in ?? 3600) * 1000,
    tokenEndpoint: discovery.token_endpoint,
    baseURL: auth.baseURL ?? DEFAULT_BASE_URL,
  }
  writeXaiAuth(path, next, discovery)
  return next
}

export async function startXaiDeviceAuthorization(path = getXaiAuthPath()): Promise<XaiDeviceAuthorization> {
  const discovery = await fetchXaiDiscovery()
  const deviceData = await requestDeviceCode()
  const intervalMs = Math.max(Number(deviceData.interval) || 5, 1) * 1000
  const expiresIn = Math.max(Number(deviceData.expires_in) || 900, 1)

  return {
    url: deviceData.verification_uri_complete || deviceData.verification_uri,
    userCode: deviceData.user_code,
    intervalMs,
    waitForAuth: () => pollXaiDeviceAuthorization(deviceData, discovery, intervalMs, expiresIn, path),
  }
}

async function fetchXaiDiscovery(timeoutMs = 15_000): Promise<Discovery> {
  if (cachedDiscovery) return cachedDiscovery
  const response = await fetch(DISCOVERY_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    throw new Error(`xAI OIDC discovery failed: ${response.status}`)
  }
  const payload = await response.json() as Partial<Discovery>
  const authorization_endpoint = String(payload.authorization_endpoint ?? "").trim()
  const token_endpoint = String(payload.token_endpoint ?? "").trim()
  if (!authorization_endpoint || !token_endpoint) {
    throw new Error("xAI OIDC discovery response was missing required endpoints.")
  }
  validateXaiOauthEndpoint(authorization_endpoint, "authorization_endpoint")
  validateXaiOauthEndpoint(token_endpoint, "token_endpoint")
  cachedDiscovery = { authorization_endpoint, token_endpoint }
  return cachedDiscovery
}

async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const response = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "openzerocode/xai-auth",
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      scope: SCOPE,
    }).toString(),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`xAI device-code request failed: ${response.status}${detail ? ` ${detail}` : ""}`)
  }
  const payload = await response.json() as Partial<DeviceCodeResponse>
  const required = [
    "device_code",
    "user_code",
    "verification_uri",
    "verification_uri_complete",
    "expires_in",
    "interval",
  ] as const
  for (const key of required) {
    if (payload[key] == null || payload[key] === "") {
      throw new Error(`xAI device-code response missing field: ${key}`)
    }
  }
  return payload as DeviceCodeResponse
}

async function pollXaiDeviceAuthorization(
  deviceData: DeviceCodeResponse,
  discovery: Discovery,
  intervalMs: number,
  expiresIn: number,
  path: string,
): Promise<XaiAuth> {
  const deadline = Date.now() + expiresIn * 1000
  let currentInterval = intervalMs

  while (Date.now() < deadline) {
    const response = await fetch(discovery.token_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "openzerocode/xai-auth",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: CLIENT_ID,
        device_code: deviceData.device_code,
      }).toString(),
    })

    if (response.ok) {
      const payload = await response.json() as TokenResponse
      if (!payload.access_token || !payload.refresh_token) {
        throw new Error("xAI device-code token response was missing required tokens.")
      }
      const auth: XaiAuth = {
        access: payload.access_token,
        refresh: payload.refresh_token,
        expires: tokenExpiry(payload.access_token) ?? Date.now() + (payload.expires_in ?? 3600) * 1000,
        tokenEndpoint: discovery.token_endpoint,
        baseURL: resolveConfiguredBaseURL(),
      }
      writeXaiAuth(path, auth, discovery)
      return auth
    }

    let errorCode = ""
    try {
      const errorPayload = await response.json() as { error?: string; error_description?: string }
      errorCode = String(errorPayload.error ?? "")
      if (errorCode === "authorization_pending") {
        await sleep(currentInterval)
        continue
      }
      if (errorCode === "slow_down") {
        currentInterval = Math.min(currentInterval + 1000, 30_000)
        await sleep(currentInterval)
        continue
      }
      if (errorCode === "expired_token" || errorCode === "access_denied") {
        throw new Error(`xAI device authorization ${errorCode}${errorPayload.error_description ? `: ${errorPayload.error_description}` : ""}`)
      }
      throw new Error(`xAI device authorization failed: ${errorCode || response.status}${errorPayload.error_description ? ` ${errorPayload.error_description}` : ""}`)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("xAI device")) throw error
      throw new Error(`xAI device authorization failed: ${response.status}`)
    }
  }

  throw new Error("xAI device authorization timed out. Re-run /xai-login.")
}

async function refreshXaiAccessToken(refreshToken: string, tokenEndpoint: string): Promise<TokenResponse> {
  validateXaiOauthEndpoint(tokenEndpoint, "token_endpoint")
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      "User-Agent": "openzerocode/xai-auth",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    }).toString(),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    if (response.status === 403) {
      throw new Error(
        `xAI token refresh failed with HTTP 403.${detail ? ` Response: ${detail}` : ""} `
        + "This OAuth account may not be authorized for xAI API access. "
        + "Set XAI_API_KEY and use a direct API-key provider if needed.",
      )
    }
    throw new Error(`xAI token refresh failed: ${response.status}${detail ? ` ${detail}` : ""}`)
  }
  return response.json() as Promise<TokenResponse>
}

function writeXaiAuth(path: string, auth: XaiAuth, discovery?: Discovery) {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const raw: StoredXaiAuthFile = {
      tokens: {
        access_token: auth.access,
        refresh_token: auth.refresh,
        token_type: "Bearer",
      },
      last_refresh: new Date().toISOString(),
      discovery: {
        authorization_endpoint: discovery?.authorization_endpoint ?? `${ISSUER}/oauth2/authorize`,
        token_endpoint: auth.tokenEndpoint ?? discovery?.token_endpoint ?? `${ISSUER}/oauth2/token`,
      },
      base_url: auth.baseURL ?? DEFAULT_BASE_URL,
      auth_mode: "oauth_device_code",
    }
    writeFileSync(path, JSON.stringify(raw, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 })
  } catch {
    // Refresh/login still succeeded; failing to persist should not discard usable tokens.
  }
}

function resolveConfiguredBaseURL() {
  return (
    process.env.OPENZEROCODE_XAI_BASE_URL?.trim()
    || process.env.HERMES_XAI_BASE_URL?.trim()
    || process.env.XAI_BASE_URL?.trim()
    || DEFAULT_BASE_URL
  ).replace(/\/$/, "")
}

export function defaultXaiBaseURL() {
  return resolveConfiguredBaseURL()
}

function validateXaiOauthEndpoint(url: string, field: string) {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invalid xAI ${field}: ${url}`)
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Refusing non-HTTPS xAI ${field}: ${url}`)
  }
  const host = parsed.hostname.toLowerCase()
  if (host !== "x.ai" && host !== "auth.x.ai" && !host.endsWith(".x.ai")) {
    throw new Error(`Refusing non-xAI ${field} host: ${host}`)
  }
}

function proactiveRefreshSkewSeconds(accessToken: string): number {
  const remainingMs = (tokenExpiry(accessToken) ?? 0) - Date.now()
  if (remainingMs <= 0) return ACCESS_TOKEN_REFRESH_SKEW_SECONDS
  if (remainingMs <= 45 * 60 * 1000) return SHORT_TOKEN_REFRESH_SKEW_SECONDS
  return ACCESS_TOKEN_REFRESH_SKEW_SECONDS
}

function tokenExpiry(token?: string): number | undefined {
  if (!token) return undefined
  try {
    const parts = token.split(".")
    if (parts.length < 2) return undefined
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as { exp?: number }
    if (typeof payload.exp !== "number") return undefined
    return payload.exp * 1000
  } catch {
    return undefined
  }
}

function lastRefreshExpiry(lastRefresh?: string): number {
  if (!lastRefresh) return 0
  const ts = Date.parse(lastRefresh)
  if (Number.isNaN(ts)) return 0
  return ts + 3600_000
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Test helper: clear cached OIDC discovery. */
export function __resetXaiDiscoveryCacheForTests() {
  cachedDiscovery = undefined
}
