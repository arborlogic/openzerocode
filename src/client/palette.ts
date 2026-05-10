export type CommandItem = { group: "Session" | "Input" | "App"; cmd: string; desc: string }

export const commandItems: CommandItem[] = [
  { group: "Session", cmd: "/help", desc: "show help" },
  { group: "Session", cmd: "/clear", desc: "clear conversation history" },
  { group: "Session", cmd: "/info", desc: "show session info" },
  { group: "Input", cmd: "/enter submit", desc: "Enter submits, Ctrl+N newline" },
  { group: "Input", cmd: "/enter newline", desc: "Enter newline, Ctrl+Enter submit" },
  { group: "App", cmd: "/exit", desc: "exit program" },
]

export function buildPalette(input: {
  query: string
  selected: number
  recent: string[]
  commands?: CommandItem[]
}) {
  const commands = input.commands ?? commandItems
  const filtered = commands
    .filter((x) => `${x.cmd} ${x.desc}`.toLowerCase().includes(input.query.toLowerCase()))
    .toSorted((a, b) => {
      const ai = input.recent.indexOf(a.cmd)
      const bi = input.recent.indexOf(b.cmd)
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })

  const commandSelected = Math.max(0, Math.min(input.selected, Math.max(0, filtered.length - 1)))
  const groups: Array<CommandItem["group"]> = ["Session", "Input", "App"]
  const items: string[] = []
  let selectedDisplay = 0
  for (const group of groups) {
    const inGroup = filtered.map((x, idx) => ({ x, idx })).filter((v) => v.x.group === group)
    if (inGroup.length === 0) continue
    items.push(`[ ${group} ]`)
    for (const v of inGroup) {
      if (v.idx === commandSelected) selectedDisplay = items.length
      items.push(`${v.x.cmd}  —  ${v.x.desc}`)
    }
  }

  return { filtered, commandSelected, selectedDisplay, items }
}

export function completeCommand(query: string, commands: CommandItem[] = commandItems) {
  const matches = commands.filter((x) => x.cmd.startsWith(query))
  if (matches.length !== 1) return
  return matches[0]?.cmd
}

export function shouldSubmitByEnter(input: {
  enterMode: "submit" | "newline"
  ctrl: boolean
  hasContent: boolean
}) {
  const submitByEnter = input.enterMode === "submit" && !input.ctrl
  const submitByCtrlEnter = input.enterMode === "newline" && input.ctrl
  return (submitByEnter || submitByCtrlEnter) && input.hasContent
}
