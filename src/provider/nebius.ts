import { layer as openAICompatibleLayer } from "./big-pickle"
import type { ProviderDef } from "./registry"

const DEFAULT_BASE = "https://api.tokenfactory.nebius.com/v1"
const DEFAULT_MODEL = "nvidia/Nemotron-3_5-Lightning"

export const def: ProviderDef = {
  id: "nebius",
  name: "Nebius Token Factory",
  defaultModel: DEFAULT_MODEL,
  envKeys: ["NEBIUS_API_KEY"],
  factory: (cfg) => openAICompatibleLayer({
    apiKey: cfg.apiKey,
    baseURL: cfg.baseURL ?? DEFAULT_BASE,
    model: cfg.model,
    filterModels: false,
  }),
}
