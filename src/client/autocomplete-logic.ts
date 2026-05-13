import type { SlashCommandDef } from "./commands"

export type AutocompleteItem = {
  display: string
  description?: string
  onSelect: () => void
}

export function extractFilter(draft: string): string {
  if (!draft.startsWith("/")) return ""
  const afterSlash = draft.slice(1)
  const spaceIdx = afterSlash.indexOf(" ")
  return spaceIdx === -1 ? afterSlash : afterSlash.slice(0, spaceIdx)
}

export function filterCommands(
  commands: SlashCommandDef[],
  filter: string,
  onCommand: (name: string, args: string) => void,
): AutocompleteItem[] {
  const results: AutocompleteItem[] = []
  for (const cmd of commands) {
    const names = [cmd.name, ...(cmd.aliases ?? [])]
    let match: string | undefined
    for (const n of names) {
      if (!filter || n.startsWith(filter)) {
        match = n
        break
      }
    }
    if (!match) continue
    results.push({
      display: `/${match}`,
      description: cmd.description,
      onSelect: () => onCommand(match, ""),
    })
  }
  return results
}

export function shouldShowAutocomplete(text: string): boolean {
  return text.startsWith("/") && !text.includes(" ")
}

export function clampIndex(prev: number, dir: -1 | 1, length: number): number {
  if (length === 0) return prev
  const next = prev + dir
  if (next < 0) return length - 1
  if (next >= length) return 0
  return next
}
