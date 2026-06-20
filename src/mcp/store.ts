import type { Def } from "../tool/types"
import { registerGroupLabel } from "../tool/selection"
import { McpClient } from "./client"
import { mcpToolToDef } from "./adapter"
import { mcpGroupId, type McpServerConfig } from "./config"

type LoadedServer = {
  config: McpServerConfig
  client: McpClient
  tools: Def[]
}

type LoadingServer = {
  client: McpClient
  promise: Promise<number>
}

const loaded = new Map<string, LoadedServer>()
const loading = new Map<string, LoadingServer>()
let configured: McpServerConfig[] = []

/** Record the configured servers and register their group labels for the UI. */
export function setConfiguredServers(servers: McpServerConfig[]): void {
  configured = servers
  for (const s of servers) {
    registerGroupLabel(mcpGroupId(s.id), s.label ?? `MCP: ${s.id}`, s.description ?? "")
  }
}

export function getConfiguredServers(): McpServerConfig[] {
  return configured
}

export function findConfiguredServer(id: string): McpServerConfig | undefined {
  return configured.find((s) => s.id === id)
}

/** All tools from currently-loaded MCP servers, merged into the registry. */
export function getMcpTools(): Def[] {
  const out: Def[] = []
  for (const s of loaded.values()) out.push(...s.tools)
  return out
}

export function isServerLoaded(id: string): boolean {
  return loaded.has(id)
}

export function isServerLoading(id: string): boolean {
  return loading.has(id)
}

/**
 * Spawn a configured server, complete the handshake, list its tools and adapt
 * them. Returns the number of tools loaded. Throws if the server cannot start.
 */
export async function loadMcpServer(config: McpServerConfig): Promise<number> {
  if (loaded.has(config.id)) return loaded.get(config.id)!.tools.length
  const activeLoad = loading.get(config.id)
  if (activeLoad) return activeLoad.promise

  const client = new McpClient(config)
  const promise = (async () => {
    try {
      await client.start()
      const specs = await client.listTools()
      const tools = specs.map((spec) => mcpToolToDef(config.id, client, spec))
      loaded.set(config.id, { config, client, tools })
      return tools.length
    } catch (err) {
      client.close()
      throw err
    } finally {
      loading.delete(config.id)
    }
  })()

  loading.set(config.id, { client, promise })
  return promise
}

export function unloadMcpServer(id: string): void {
  const activeLoad = loading.get(id)
  if (activeLoad) {
    activeLoad.client.close()
    loading.delete(id)
  }

  const server = loaded.get(id)
  if (!server) return
  server.client.close()
  loaded.delete(id)
}

export function unloadAllMcpServers(): void {
  for (const id of new Set([...loading.keys(), ...loaded.keys()])) unloadMcpServer(id)
}
