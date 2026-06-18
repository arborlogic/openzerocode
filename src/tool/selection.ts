import type { Def } from "./types"

/**
 * Human-facing labels and descriptions for selectable tool groups. A group id
 * that appears on a tool's `Def.group` but is missing here still works — it
 * falls back to the raw id as its label.
 */
export const TOOL_GROUPS: Record<string, { label: string; description: string }> = {
  browser: {
    label: "Browser (GEASS)",
    description: "GEASS desktop browser control (navigate / read / click / type / screenshot)",
  },
  peer: {
    label: "Peer calls",
    description: "Send tasks to other named openzerocode processes (requires --name)",
  },
}

export type ToolGroupInfo = {
  id: string
  label: string
  description: string
  /** Number of tools that belong to this group. */
  count: number
  enabled: boolean
}

/** A tool is selectable iff it declares a `group`. */
export function isSelectable(def: Def): boolean {
  return typeof def.group === "string" && def.group.length > 0
}

/**
 * Filter a tool list down to the set the model should see, dropping every tool
 * whose group is in `disabledGroups`. Core tools (no group) always pass.
 */
export function selectEnabledTools(
  tools: readonly Def[],
  disabledGroups: readonly string[],
): Def[] {
  if (disabledGroups.length === 0) return [...tools]
  const disabled = new Set(disabledGroups)
  return tools.filter((t) => !t.group || !disabled.has(t.group))
}

/**
 * Summarize the selectable groups present in a tool list, marking each as
 * enabled/disabled given the current denylist. Used to render the Experiments
 * → Tools selection UI.
 */
export function listSelectableGroups(
  tools: readonly Def[],
  disabledGroups: readonly string[],
): ToolGroupInfo[] {
  const disabled = new Set(disabledGroups)
  const counts = new Map<string, number>()
  for (const t of tools) {
    if (!isSelectable(t)) continue
    counts.set(t.group!, (counts.get(t.group!) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([id, count]) => ({
      id,
      label: TOOL_GROUPS[id]?.label ?? id,
      description: TOOL_GROUPS[id]?.description ?? "",
      count,
      enabled: !disabled.has(id),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** Toggle a group's membership in the denylist, returning the next denylist. */
export function toggleGroup(disabledGroups: readonly string[], groupId: string): string[] {
  return disabledGroups.includes(groupId)
    ? disabledGroups.filter((g) => g !== groupId)
    : [...disabledGroups, groupId]
}
