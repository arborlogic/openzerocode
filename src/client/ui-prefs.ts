import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs"
import { join } from "path"
import { homedir } from "os"

type UIPrefs = {
  toolDefaultsVersion: number
  showCompletedTools: boolean
  showThinkingBlocks: boolean
  layoutMode: "horizontal" | "vertical"
  autoCompressionEnabled: boolean
  maxSteps: number
  /**
   * Force visual image/screenshot analysis through a configured local VLM even
   * when the active chat model supports native vision.
   */
  forceLocalVlm: boolean
  localVlmEndpoint: string
  localVlmModel: string
  /**
   * Selectable tool groups the user has turned off (denylist; core tools always
   * on). The "browser" group also acts as the single on/off control for GEASS.
   */
  disabledToolGroups: string[]
  /**
   * MCP servers the user has explicitly turned on (allowlist; opt-in). MCP
   * servers are off by default so we never spawn an external process
   * (e.g. `chrome-devtools-mcp`) unattended.
   */
  enabledMcpServers: string[]
}

const TOOL_DEFAULTS_VERSION = 2
const DEFAULT_DISABLED_TOOL_GROUPS = ["browser"]

const DEFAULTS: UIPrefs = {
  toolDefaultsVersion: TOOL_DEFAULTS_VERSION,
  showCompletedTools: false,
  showThinkingBlocks: true,
  layoutMode: "horizontal",
  autoCompressionEnabled: true,
  maxSteps: 50,
  forceLocalVlm: false,
  localVlmEndpoint: "",
  localVlmModel: "",
  disabledToolGroups: DEFAULT_DISABLED_TOOL_GROUPS,
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
    const migrated = { ...DEFAULTS, ...parsed }
    if ((parsed.toolDefaultsVersion ?? 0) < TOOL_DEFAULTS_VERSION) {
      migrated.disabledToolGroups = [...new Set([
        ...(Array.isArray(parsed.disabledToolGroups) ? parsed.disabledToolGroups : []),
        ...DEFAULT_DISABLED_TOOL_GROUPS,
      ])].filter((group) => group !== "peer")
      migrated.toolDefaultsVersion = TOOL_DEFAULTS_VERSION
    }
    return migrated
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
