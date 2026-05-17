/** A command registered by a plugin, dispatched via /command syntax */
export type PluginCommand = {
  name: string
  description: string
  args?: string
  execute(args: string, ctx: PluginCommandContext): Promise<string | void>
}

export type PluginCommandContext = {
  notices: (text: string, kind?: "system" | "error") => void
}

/**
 * Plugin 的完整介面。
 *
 * Plugin 是一個靜態物件（非 factory function），在 openzerocode 啟動時註冊。
 * 所有欄位都是可選的 — 一個 plugin 可以只提供 commands、只注入 system prompt、
 * 或只掛鉤生命週期。
 */
export type Plugin = {
  id: string
  name: string
  version?: string

  /** Slash commands registered by this plugin */
  commands?: PluginCommand[]

  /** Fragment injected into the system prompt */
  systemPrompt?: () => string | undefined

  /** Called before each LLM request */
  beforeRequest?: (
    input: string,
    history: Message[],
  ) => Promise<{ input?: string; extraMessages?: Message[] }>

  /** Called after each LLM response */
  afterResponse?: (
    input: string,
    response: Message,
    history: Message[],
  ) => Promise<void>
}

/** Minimal message type so Plugin doesn't depend on ../provider/types */
type Message = {
  role: string
  content?: string
  [key: string]: unknown
}
