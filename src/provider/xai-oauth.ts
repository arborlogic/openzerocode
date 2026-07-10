import { Effect, Layer } from "effect"
import { Provider, type CompletionRequest } from "./types"
import type { ProviderDef } from "./registry"
import { defaultXaiBaseURL, hasXaiAuth, resolveXaiAuth } from "./xai-auth"
import {
  createResponsesStream,
  responseToCompletion,
  toResponsesRequestBody,
} from "./responses-api"

const DEFAULT_BASE_URL = "https://api.x.ai/v1"
const MODELS = [
  "grok-build-0.1",
  "grok-composer-2.5-fast",
  "grok-4.5",
  "grok-4.3",
  "grok-4.20-0309-reasoning",
  "grok-4.20-0309-non-reasoning",
  "grok-4.20-multi-agent-0309",
]

function normalizeBaseURL(baseURL?: string) {
  const value = (baseURL || defaultXaiBaseURL() || DEFAULT_BASE_URL).replace(/\/$/, "")
  return value
}

function responsesEndpoint(baseURL?: string) {
  return `${normalizeBaseURL(baseURL)}/responses`
}

export function toXaiRequestBody(req: CompletionRequest) {
  return toResponsesRequestBody(req)
}

export const layer = (input: { model?: string; baseURL?: string }) =>
  Layer.effect(
    Provider,
    Effect.gen(function* () {
      const defaultModel = input.model ?? "grok-build-0.1"
      const configuredBaseURL = input.baseURL

      async function headersAndEndpoint() {
        const auth = await resolveXaiAuth()
        return {
          endpoint: responsesEndpoint(configuredBaseURL || auth.baseURL),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${auth.access}`,
            "User-Agent": "openzerocode/xai-oauth",
          } as Record<string, string>,
        }
      }

      const complete = (req: CompletionRequest) =>
        Effect.gen(function* () {
          const model = req.model || defaultModel
          const { signal, ...wire } = req
          const { endpoint, headers } = yield* Effect.promise(() => headersAndEndpoint())
          const res = yield* Effect.promise(async () =>
            fetch(endpoint, {
              method: "POST",
              headers,
              body: JSON.stringify({ ...toXaiRequestBody({ ...wire, model }), stream: false }),
              signal,
            }),
          )
          if (!res.ok) {
            const text = yield* Effect.promise(() => res.text())
            return yield* Effect.die(new Error(`xAI API error ${res.status}: ${text}`))
          }
          const json = yield* Effect.promise(() => res.json()) as Effect.Effect<any>
          return responseToCompletion(json, model, "xai")
        }).pipe(Effect.orDie)

      const stream = (req: CompletionRequest) =>
        Effect.gen(function* () {
          const model = req.model || defaultModel
          const { signal, ...wire } = req
          const { endpoint, headers } = yield* Effect.promise(() => headersAndEndpoint())
          const res = yield* Effect.promise(async () =>
            fetch(endpoint, {
              method: "POST",
              headers,
              body: JSON.stringify({ ...toXaiRequestBody({ ...wire, model }), stream: true }),
              signal,
            }),
          )
          if (!res.ok) {
            const text = yield* Effect.promise(() => res.text())
            return yield* Effect.die(new Error(`xAI API error ${res.status}: ${text}`))
          }
          const body = res.body
          if (!body) return yield* Effect.die(new Error("No response body"))
          return createResponsesStream(body, signal)
        }).pipe(Effect.orDie)

      const models = () => Effect.succeed(MODELS.map((id) => ({ id })))

      return { complete, stream, models }
    }).pipe(Effect.orDie),
  )

export const def: ProviderDef = {
  id: "xai-oauth",
  name: "xAI Grok OAuth",
  defaultModel: "grok-build-0.1",
  authOptional: true,
  detectAuth: hasXaiAuth,
  factory: (cfg) => layer({ model: cfg.model, baseURL: cfg.baseURL }),
}
