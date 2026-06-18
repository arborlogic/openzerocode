import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

type UIPrefs = {
  showCompletedTools: boolean
  showThinkingBlocks: boolean
  layoutMode: "horizontal" | "vertical"
  autoCompressionEnabled: boolean
  maxSteps: number
  /**
   * Selectable tool groups the user has turned off (denylist; core tools always
   * on). The "browser" group also acts as the single on/off control for GEASS.
   */
  disabledToolGroups: string[]
  /**
   * MCP servers the user has explicitly turned on (allowlist; opt-in). MCP
   * servers are off by default so we never spawn an external process (e.g.
   * `npx chrome-devtools-mcp`) unattended.
   */
  enabledMcpServers: string[]
}

const DEFAULTS: UIPrefs = {
  showCompletedTools: false,
  showThinkingBlocks: true,
  layoutMode: "horizontal",
  autoCompressionEnabled: false,
  maxSteps: 50,
  disabledToolGroups: [],
  enabledMcpServers: [],
}

function getPrefsPath() {
  return join(homedir(), ".openzerocode", "ui-prefs.json")
}

function ensureDir() {
  const dir = join(homedir(), ".openzerocode")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function loadUIPrefs(): UIPrefs {
  try {
    const raw = readFileSync(getPrefsPath(), "utf-8")
    const parsed = JSON.parse(raw)
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveUIPrefs(prefs: Partial<UIPrefs>) {
  try {
    ensureDir()
    const current = loadUIPrefs()
    const next = { ...current, ...prefs }
    const path = getPrefsPath()
    const tmp = path + ".tmp"
    writeFileSync(tmp, JSON.stringify(next, null, 2), "utf-8")
    renameSync(tmp, path)
  } catch {
    // non-critical — silently ignore write failures
  }
}
