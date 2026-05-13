import { layer as openAICompatibleLayer } from "./big-pickle"
import type { ProviderDef } from "./registry"

const DEFAULT_BASE = "https://openrouter.ai/api/v1"

export const def: ProviderDef = {
  id: "openrouter",
  name: "OpenRouter",
  defaultModel: "openrouter/auto",
  factory: (cfg) => openAICompatibleLayer({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL ?? DEFAULT_BASE,
    model: cfg.model,
  }),
}
