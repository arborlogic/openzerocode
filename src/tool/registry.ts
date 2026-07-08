import { Effect, Context, Layer } from "effect"
import { Def } from "./types"
import { ReadTool } from "./read"
import { WriteTool } from "./write"
import { GrepTool } from "./grep"
import { GlobTool } from "./glob"
import { BashTool } from "./bash"
import { EditTool } from "./edit"
import { WebFetchTool } from "./web-fetch"
import { TodoWriteTool } from "./todo"
import { BrowserNavigateTool } from "./browser-navigate"
import { BrowserReadTool } from "./browser-read"
import { BrowserClickTool } from "./browser-click"
import { BrowserTypeTool } from "./browser-type"
import { BrowserSelectTool } from "./browser-select"
import { BrowserScrollTool } from "./browser-scroll"
import { BrowserScreenshotTool } from "./browser-screenshot"
import { BrowserObserveVisualTool } from "./browser-observe-visual"
import { CallPeerTool } from "./call-peer"
import { LearnMemoryApplyTool } from "./learn-memory"
import { getMcpTools } from "../mcp/store"

export interface Interface {
  readonly all: () => Effect.Effect<readonly Def[]>
  readonly get: (id: string) => Effect.Effect<Def | undefined>
  readonly register: (def: Def) => Effect.Effect<void>
}

export class ToolRegistry extends Context.Service<ToolRegistry, Interface>()("@openzerocode/ToolRegistry") {}

export const layer = Layer.effect(
  ToolRegistry,
  Effect.gen(function* () {
    const builtins: Def[] = [
      yield* ReadTool,
      yield* WriteTool,
      yield* GrepTool,
      yield* GlobTool,
      yield* BashTool,
      yield* EditTool,
      yield* WebFetchTool,
      yield* TodoWriteTool,
      yield* BrowserNavigateTool,
      yield* BrowserReadTool,
      yield* BrowserClickTool,
      yield* BrowserTypeTool,
      yield* BrowserSelectTool,
      yield* BrowserScrollTool,
      yield* BrowserScreenshotTool,
      yield* BrowserObserveVisualTool,
      yield* CallPeerTool,
      yield* LearnMemoryApplyTool,
    ]
    const custom: Def[] = []

    // MCP tools live in a module-level store (src/mcp/store.ts) rather than the
    // per-layer `custom` array so they survive Layer rebuilds (provider/model
    // switches) and stay visible to every turn once a server is loaded.
    return {
      all: () => Effect.succeed([...builtins, ...custom, ...getMcpTools()] as readonly Def[]),
      get: (id: string) =>
        Effect.succeed([...builtins, ...custom, ...getMcpTools()].find((t) => t.id === id)),
      register: (def: Def) =>
        Effect.sync(() => { custom.push(def) }),
    }
  }),
)
