import { layer as openAICompatibleLayer } from "./big-pickle"
import type { ProviderDef } from "./registry"

const DEFAULT_BASE = "https://api.openai.com/v1"

export const def: ProviderDef = {
  id: "openai",
  name: "OpenAI",
  defaultModel: "gpt-5.4",
  envKeys: ["OPENAI_API_KEY"],
  factory: (cfg) => openAICompatibleLayer({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL ?? DEFAULT_BASE,
    model: cfg.model,
    filterModels: false,
  }),
}
