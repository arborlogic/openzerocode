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

/** Cycle the argument of an already selected slash command. */
export function cycleCommandArgument(
  draft: string,
  commands: SlashCommandDef[],
  direction: -1 | 1 = 1,
): string | undefined {
  const match = draft.match(/^\/(\S+)(?:\s+(.*))?$/)
  if (!match) return undefined

  const enteredName = match[1]!.toLowerCase()
  const command = commands.find((item) =>
    item.name.toLowerCase() === enteredName || item.aliases?.some((alias) => alias.toLowerCase() === enteredName),
  )
  const options = command?.argumentOptions
  if (!options?.length) return undefined

  const current = (match[2] ?? "").trim()
  const currentIndex = options.indexOf(current)
  const nextIndex = currentIndex === -1
    ? (direction === 1 ? 0 : options.length - 1)
    : clampIndex(currentIndex, direction, options.length)
  return `/${match[1]} ${options[nextIndex]}`
}
