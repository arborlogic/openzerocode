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

const loaded = new Map<string, LoadedServer>()
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

/**
 * Spawn a configured server, complete the handshake, list its tools and adapt
 * them. Returns the number of tools loaded. Throws if the server cannot start.
 */
export async function loadMcpServer(config: McpServerConfig): Promise<number> {
  if (loaded.has(config.id)) return loaded.get(config.id)!.tools.length
  const client = new McpClient(config)
  await client.start()
  const specs = await client.listTools()
  const tools = specs.map((spec) => mcpToolToDef(config.id, client, spec))
  loaded.set(config.id, { config, client, tools })
  return tools.length
}

export function unloadMcpServer(id: string): void {
  const server = loaded.get(id)
  if (!server) return
  server.client.close()
  loaded.delete(id)
}

export function unloadAllMcpServers(): void {
  for (const id of [...loaded.keys()]) unloadMcpServer(id)
}
