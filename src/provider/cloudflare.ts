import { layer as openAICompatibleLayer } from "./big-pickle"
import type { ProviderDef } from "./registry"

export const def: ProviderDef = {
  id: "cloudflare",
  name: "Cloudflare",
  env: { apiKey: ["CLOUDFLARE_API", "CLOUDFLARE_API_KEY"], baseURL: "CLOUDFLARE_BASE_URL" },
  factory: (cfg) => openAICompatibleLayer({ apiKey: cfg.apiKey, baseURL: cfg.baseURL, model: cfg.model }),
}
