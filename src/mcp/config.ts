import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { McpServerSpec } from "./client"

export type McpServerConfig = McpServerSpec & {
  /** Stable id used for the tool group "mcp:<id>" and the tool id prefix. */
  id: string
  /** Human-facing label shown in Experiments → Tools. */
  label?: string
  /** Short description shown in the selection UI. */
  description?: string
}

export type McpConfigFile = {
  servers: McpServerConfig[]
}

/**
 * Seed config written on first run. Chrome DevTools MCP is included as a ready
 * example. It is NOT spawned unless the user enables its group in
 * Experiments → Tools, so Chrome is never launched unattended.
 *
 * Uses the globally installed `chrome-devtools-mcp` (from npm) rather than
 * `npx` to avoid version-resolution delay on every startup. If you don't have
 * it installed globally, run `npm i -g chrome-devtools-mcp`.
 *
 * Important: default to launching Chrome directly instead of `--autoConnect`.
 * `--autoConnect` only works when the user already has a compatible Chrome
 * running with remote debugging enabled, which is a fragile default and often
 * looks like “Chrome MCP cannot connect”. Launching Chrome through the MCP
 * server is much more reliable for first-run behavior.
 */
const DEFAULT_CONFIG: McpConfigFile = {
  servers: [
    {
      id: "chrome",
      label: "Chrome (MCP)",
      description: "chrome-devtools-mcp — launch/control Chrome via DevTools Protocol",
      command: "chrome-devtools-mcp",
      args: [],
    },
  ],
}

export function mcpConfigPath(): string {
  return process.env.OPENZEROCODE_MCP_CONFIG || join(homedir(), ".openzerocode", "mcp.json")
}

function ensureDir(path: string) {
  const dir = path.slice(0, path.lastIndexOf("/"))
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
}

/**
 * Load the MCP server configuration. On first run (no file) a commented example
 * with the Chrome server is written so the user can discover and tweak it.
 */
export function loadMcpConfig(): McpServerConfig[] {
  const path = mcpConfigPath()
  if (!existsSync(path)) {
    try {
      ensureDir(path)
      writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8")
    } catch {
      // Non-critical: fall back to in-memory defaults.
    }
    return DEFAULT_CONFIG.servers
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<McpConfigFile>
    const servers = Array.isArray(parsed.servers) ? parsed.servers : []
    const valid = servers.filter((s): s is McpServerConfig => Boolean(s && s.id && s.command))

    // Migrate the old first-run Chrome example away from `--autoConnect`.
    // That mode requires the user to pre-launch Chrome with remote debugging,
    // which causes confusing connection failures for the default setup.
    let changed = false
    const migrated = valid.map((server) => {
      if (
        server.id === "chrome" &&
        server.command === "chrome-devtools-mcp" &&
        Array.isArray(server.args) &&
        server.args.length === 1 &&
        server.args[0] === "--autoConnect"
      ) {
        changed = true
        return {
          ...server,
          description: "chrome-devtools-mcp — launch/control Chrome via DevTools Protocol",
          args: [],
        }
      }
      return server
    })

    if (changed) {
      try {
        ensureDir(path)
        writeFileSync(path, JSON.stringify({ servers: migrated }, null, 2), "utf-8")
      } catch {
        // Non-critical: use the migrated config in memory even if persisting fails.
      }
    }

    return migrated
  } catch {
    return []
  }
}

export function mcpGroupId(serverId: string): string {
  return `mcp:${serverId}`
}
