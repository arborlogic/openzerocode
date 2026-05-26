import { layer as openAICompatibleLayer } from "./big-pickle"
import type { ProviderDef } from "./registry"

const DEFAULT_BASE = "https://api.deepseek.com/v1"

export const def: ProviderDef = {
  id: "deepseek",
  name: "DeepSeek",
  defaultModel: "deepseek-v4-flash",
  envKeys: ["DEEPSEEK_API_KEY"],
  factory: (cfg) => openAICompatibleLayer({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL ?? DEFAULT_BASE,
    model: cfg.model,
    filterModels: false,
  }),
}
