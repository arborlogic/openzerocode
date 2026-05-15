import { Index, Show, createEffect, createMemo, createSignal } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import type { SlashCommandDef } from "./commands"
import { extractFilter, filterCommands, shouldShowAutocomplete, clampIndex } from "./autocomplete-logic"

export type AutocompleteApi = {
  move: (dir: -1 | 1) => void
  select: () => void
  visible: () => boolean
}

export function SlashAutocomplete(props: {
  commands: SlashCommandDef[]
  draft: () => string
  onCommand: (name: string, args: string) => void
  onHide: () => void
  ref?: (api: AutocompleteApi) => void
  bottom: number
  left: number
  width: number
}) {
  const [selected, setSelected] = createSignal(0)
  const [visible, setVisible] = createSignal(false)

  let scroll: ScrollBoxRenderable | undefined

  const filter = createMemo(() => {
    if (!visible()) return ""
    return extractFilter(props.draft())
  })

  const items = createMemo(() => {
    return filterCommands(props.commands, filter(), (name) => props.onCommand(name, ""))
  })

  // +1 to account for the top border row in the scrollbox
  const height = createMemo(() => Math.min(8, items().length || 1) + 1)

  function move(dir: -1 | 1) {
    const list = items()
    if (!list.length) return
    setSelected((prev) => clampIndex(prev, dir, list.length))
  }

  function select() {
    const list = items()
    const item = list[selected()]
    if (!item) return
    hide()
    item.onSelect()
  }

  function hide() {
    setVisible(false)
    props.onHide()
  }

  function checkVisibility(text: string) {
    if (shouldShowAutocomplete(text)) {
      setVisible(true)
      setSelected(0)
    } else {
      setVisible(false)
    }
  }

  createEffect(() => {
    checkVisibility(props.draft())
  })

  props.ref?.({ move, select, visible })

  return (
    <Show when={visible()}>
      <box
        position="absolute"
        bottom={props.bottom}
        left={props.left}
        width={props.width}
        zIndex={50}
      >
        <scrollbox
          ref={(r) => (scroll = r)}
          backgroundColor="#151515"
          height={height()}
          paddingLeft={1}
          paddingRight={1}
          scrollY={true}
          border={["left", "top", "right"]}
          borderColor="#2a2a2a"
        >
          <Index each={items()}>
            {(item, index) => (
              <box
                backgroundColor={index === selected() ? "#58a6ff" : undefined}
                flexDirection="row"
                paddingTop={0}
                paddingBottom={0}
                onMouseMove={() => setSelected(index)}
                onMouseDown={() => { setSelected(index); select() }}
              >
                <text fg={index === selected() ? "#101010" : "#eeeeee"} flexShrink={0}>
                  {item().display}
                </text>
                <Show when={item().description}>
                  <text fg={index === selected() ? "#101010" : "#8f8f8f"} wrapMode="none">
                    {" "}{item().description}
                  </text>
                </Show>
              </box>
            )}
          </Index>
        </scrollbox>
      </box>
    </Show>
  )
}
