import { Effect, Layer } from "effect"
import { buildLayer, autoDetectProvider, defaultModelForProvider, normalizeBigPickleModel } from "../provider/index"
import { Provider } from "../provider/types"
import { ToolRegistry, layer as toolLayer } from "../tool/registry"
import { streamSession, type RunMode } from "../client/session-runner"
import { createSession, loadSessionState, saveSession, deleteSession, listSessions, markSessionActive, unmarkSessionActive } from "../client/sessions"
import { buildSystemPrompt } from "../client/system-prompt"
import { loadAgentsInstruction, loadContextInstruction } from "../client/workspace-memory"
import type { Message } from "../provider/types"
import type { StreamChunk } from "./types"

type ServeOptions = {
  port: number
  host: string
}

function tryParseJSON(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function errorResponse(message: string, code: string, status: number): Response {
  return jsonResponse({ error: message, code }, status)
}

function makeRunSync(layer: Layer.Layer<Provider | ToolRegistry>) {
  return <E, A>(effect: Effect.Effect<A, E, ToolRegistry | Provider>): Promise<A> =>
    Effect.runPromise(effect.pipe(Effect.provide(layer)))
}

export async function startServer(options: ServeOptions): Promise<void> {
  const { port, host } = options

  const server = Bun.serve({
    port,
    hostname: host,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      try {
        // POST /session — create a new session
        if (req.method === "POST" && path === "/session") {
          return await handleCreateSession(req)
        }

        // GET /session — list sessions
        if (req.method === "GET" && path === "/session") {
          return handleListSessions(url)
        }

        // GET /session/:id
        const getMatch = path.match(/^\/session\/([^/]+)$/)
        if (getMatch && req.method === "GET") {
          return handleGetSession(getMatch[1]!)
        }

        // DELETE /session/:id
        if (getMatch && req.method === "DELETE") {
          return handleDeleteSession(getMatch[1]!)
        }

        // POST /session/:id/prompt — streaming response
        const promptMatch = path.match(/^\/session\/([^/]+)\/prompt$/)
        if (promptMatch && req.method === "POST") {
          return await handlePrompt(promptMatch[1]!, req)
        }

        // GET /health
        if (req.method === "GET" && path === "/health") {
          return jsonResponse({ ok: true })
        }

        return errorResponse("Not found", "NOT_FOUND", 404)
      } catch (err) {
        return errorResponse(String(err instanceof Error ? err.message : err), "INTERNAL", 500)
      }
    },
  })

  console.log(`openzerocode server listening on http://${server.hostname}:${server.port}`)
}

// ─── Handlers ────────────────────────────────────────────────────────────

async function handleCreateSession(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null) as
    | { workdir?: string; model?: string; provider?: string }
    | null
  if (!body || typeof body.workdir !== "string" || !body.workdir.trim()) {
    return errorResponse("workdir is required", "BAD_REQUEST", 400)
  }

  const provider = body.provider ?? autoDetectProvider() ?? "opencode-zen"
  const rawModel = body.model ?? defaultModelForProvider(provider)
  const model = provider === "opencode-zen" ? normalizeBigPickleModel(rawModel) : rawModel

  const meta = createSession(model, provider, undefined, body.workdir)
  return jsonResponse({
    id: meta.id,
    title: meta.title,
    workdir: meta.directory,
    model: meta.model,
    provider: meta.provider,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    messageCount: meta.messageCount,
  })
}

function handleListSessions(url: URL): Response {
  const directory = url.searchParams.get("workdir") ?? null
  const sessions = listSessions({ directory })
  return jsonResponse({ sessions })
}

function handleGetSession(id: string): Response {
  const state = loadSessionState(id)
  if (!state) {
    const meta = listSessions({ directory: null, includeEmpty: true }).find((s) => s.id === id)
    if (!meta) return errorResponse("Session not found", "NOT_FOUND", 404)
    return jsonResponse({
      id: meta.id,
      title: meta.title,
      workdir: meta.directory,
      model: meta.model,
      provider: meta.provider,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      messageCount: meta.messageCount,
      messages: [],
    })
  }
  const meta = listSessions({ directory: null, includeEmpty: true }).find((s) => s.id === id)
  return jsonResponse({
    id,
    title: meta?.title,
    workdir: meta?.directory,
    model: state.model,
    provider: state.provider,
    mode: state.mode,
    messages: state.messages,
    createdAt: meta?.createdAt,
    updatedAt: meta?.updatedAt,
  })
}

function handleDeleteSession(id: string): Response {
  const ok = deleteSession(id)
  if (!ok) return errorResponse("Session not found", "NOT_FOUND", 404)
  return jsonResponse({ ok: true })
}

async function handlePrompt(id: string, req: Request): Promise<Response> {
  const body = await req.json().catch(() => null) as
    | { text?: string; mode?: RunMode }
    | null
  if (!body || typeof body.text !== "string" || !body.text.length) {
    return errorResponse("text is required", "BAD_REQUEST", 400)
  }

  const state = loadSessionState(id)
  const meta = listSessions({ directory: null, includeEmpty: true }).find((s) => s.id === id)
  if (!meta) return errorResponse("Session not found", "NOT_FOUND", 404)

  const workdir = meta.directory ?? process.cwd()
  const model = state?.model ?? meta.model
  const provider = state?.provider ?? meta.provider
  const mode: RunMode = body.mode ?? (state?.mode as RunMode | undefined) ?? "build"
  const history: Message[] = state?.messages ?? []

  // Per-request runtime layer (provider + tools)
  const layer = Layer.merge(buildLayer(provider, model), toolLayer)
  const runSync = makeRunSync(layer)

  const agentsInstruction = loadAgentsInstruction(workdir)
  const contextInstruction = loadContextInstruction(workdir)

  const abortController = new AbortController()
  req.signal.addEventListener("abort", () => abortController.abort(), { once: true })

  markSessionActive(id)

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writeChunk = (chunk: StreamChunk) => {
        controller.enqueue(encoder.encode(JSON.stringify(chunk) + "\n"))
      }

      try {
        const gen = streamSession(body.text!, history, {
          abort: abortController.signal,
          model,
          mode,
          provider,
          keyName: "server",
          workdir,
        }, {
          runSync,
          systemPrompt: (m) => buildSystemPrompt(m, agentsInstruction, contextInstruction),
          parseJson: tryParseJSON,
          compactionSummary: state?.compaction?.summary,
          // Server mode: auto-approve all tool requests. Permission gating is
          // expected to happen out-of-band (or be added later via a callback).
          ask: () => Promise.resolve(),
        })

        let finalHistory: Message[] = history
        while (true) {
          const { value, done } = await gen.next()
          if (done) {
            finalHistory = value
            break
          }
          writeChunk(value)
        }

        // Persist updated history. The generator already emits its own
        // "done" chunk before returning, so we don't double-emit here.
        saveSession(
          id,
          finalHistory,
          model,
          provider,
          mode,
          state?.compaction,
          state?.permissionRules,
          state?.autoApprove,
        )
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        writeChunk({ type: "error", message })
      } finally {
        unmarkSessionActive(id)
        controller.close()
      }
    },
    cancel() {
      abortController.abort()
      unmarkSessionActive(id)
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  })
}
