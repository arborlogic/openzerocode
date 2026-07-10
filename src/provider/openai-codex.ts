import { Effect, Layer } from "effect"
import { Provider, type CompletionRequest } from "./types"
import type { ProviderDef } from "./registry"
import { hasCodexAuth, resolveCodexAuth } from "./codex-auth"
import {
  createResponsesStream,
  responseToCompletion,
  toResponsesRequestBody,
} from "./responses-api"

const CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses"
const MODELS = ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-codex", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2"]

export function toCodexRequestBody(req: CompletionRequest) {
  return toResponsesRequestBody(req)
}

export const layer = (input: { model?: string }) =>
  Layer.effect(
    Provider,
    Effect.gen(function* () {
      const defaultModel = input.model ?? "gpt-5.4"

      async function headers() {
        const auth = await resolveCodexAuth()
        const result: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.access}`,
          originator: "opencode",
          "User-Agent": "openzerocode/codex-auth",
        }
        if (auth.accountId) result["ChatGPT-Account-Id"] = auth.accountId
        return result
      }

      const complete = (req: CompletionRequest) =>
        Effect.gen(function* () {
          const model = req.model || defaultModel
          const { signal, ...wire } = req
          const res = yield* Effect.promise(async () =>
            fetch(CODEX_API_ENDPOINT, {
              method: "POST",
              headers: await headers(),
              body: JSON.stringify({ ...toCodexRequestBody({ ...wire, model }), stream: false }),
              signal,
            }),
          )
          if (!res.ok) {
            const text = yield* Effect.promise(() => res.text())
            return yield* Effect.die(new Error(`Codex API error ${res.status}: ${text}`))
          }
          const json = yield* Effect.promise(() => res.json()) as Effect.Effect<any>
          return responseToCompletion(json, model, "codex")
        }).pipe(Effect.orDie)

      const stream = (req: CompletionRequest) =>
        Effect.gen(function* () {
          const model = req.model || defaultModel
          const { signal, ...wire } = req
          const res = yield* Effect.promise(async () =>
            fetch(CODEX_API_ENDPOINT, {
              method: "POST",
              headers: await headers(),
              body: JSON.stringify({ ...toCodexRequestBody({ ...wire, model }), stream: true }),
              signal,
            }),
          )
          if (!res.ok) {
            const text = yield* Effect.promise(() => res.text())
            return yield* Effect.die(new Error(`Codex API error ${res.status}: ${text}`))
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
  id: "openai-codex",
  name: "OpenAI Codex",
  defaultModel: "gpt-5.4",
  authOptional: true,
  detectAuth: hasCodexAuth,
  factory: (cfg) => layer({ model: cfg.model }),
}
