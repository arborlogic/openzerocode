/**
 * Minimal zero-api HTTP client.
 *
 * This is a thin wrapper around zero-api's REST endpoints.
 * It assumes zero-api is running on localhost (default port 9099).
 *
 * Usage:
 *   const api = new ZeroAPI({ baseUrl: "http://localhost:9099", apiKey: "..." })
 *   await api.createMemory({ title: "...", content: "...", type: "daily" })
 *   const results = await api.searchMemory("some query")
 */

export type ZeroAPIMemoryInput = {
  title: string
  content: string
  type: string
  tags?: string[]
}

export type ZeroAPIMemoryHit = {
  id: string
  title: string
  content: string
  type: string
  tags: string[]
  score?: number
  created_at: string
  updated_at: string
}

export type ZeroAPIConfig = {
  baseUrl?: string
  apiKey?: string
}

const DEFAULT_BASE_URL = "http://localhost:9099"

export class ZeroAPI {
  private baseUrl: string
  private apiKey: string | undefined

  constructor(config: ZeroAPIConfig = {}) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
    this.apiKey = config.apiKey
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    try {
      const url = `${this.baseUrl}${path}`
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      }
      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`
      }

      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      })

      if (!res.ok) {
        const text = await res.text().catch(() => "unknown error")
        return { ok: false, error: `zero-api responded ${res.status}: ${text}` }
      }

      const data = (await res.json()) as T
      return { ok: true, data }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { ok: false, error: `zero-api request failed: ${message}` }
    }
  }

  /** Create a new memory entry */
  async createMemory(input: ZeroAPIMemoryInput) {
    return this.request<ZeroAPIMemoryHit>("POST", "/v1/memory", input)
  }

  /** Search memories by keyword */
  async searchMemory(query: string, limit = 5) {
    const params = new URLSearchParams({ q: query, limit: String(limit) })
    return this.request<ZeroAPIMemoryHit[]>("GET", `/v1/memory/search?${params}`)
  }

  /** Health check */
  async ping() {
    return this.request<{ status: string }>("GET", "/v1/health")
  }
}
