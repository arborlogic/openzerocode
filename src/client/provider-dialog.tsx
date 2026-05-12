import { Index, Show, createEffect, createMemo, createSignal } from "solid-js"
import type { InputRenderable } from "@opentui/core"
import type { ProviderDef } from "../provider/index"

export type ProviderDialogApi = {
  move: (dir: -1 | 1) => void
  select: () => void
}

export function ProviderDialog(props: {
  providers: ProviderDef[]
  current: string
  onSelect: (id: string) => void
  ref?: (api: ProviderDialogApi) => void
}) {
  const [filter, setFilter] = createSignal("")
  const [selected, setSelected] = createSignal(0)
  let input: InputRenderable | undefined

  const items = createMemo(() => {
    const q = filter().toLowerCase()
    return props.providers.filter(
      (p) => !q || p.id.includes(q) || p.name.toLowerCase().includes(q),
    )
  })

  createEffect(() => {
    const n = items().length
    if (n > 0 && selected() >= n) setSelected(n - 1)
  })

  createEffect(() => {
    setFilter("")
    setSelected(0)
    setTimeout(() => {
      if (input && !input.isDestroyed) input.focus()
    }, 1)
  })

  function move(dir: -1 | 1) {
    const n = items().length
    if (n === 0) return
    setSelected((prev) => {
      const next = prev + dir
      if (next < 0) return n - 1
      if (next >= n) return 0
      return next
    })
  }

  function confirm() {
    const item = items()[selected()]
    if (!item) return
    props.onSelect(item.id)
  }

  props.ref?.({ move, select: confirm })

  return (
    <box
      flexDirection="column"
      width={60}
      maxWidth={72}
      backgroundColor="#0d1117"
      border={["top", "left", "right", "bottom"]}
      borderColor="#30363d"
    >
      <box backgroundColor="#161b22" paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
        <text style={{ fg: "#58a6ff" }}>Select Provider (Esc to close)</text>
      </box>
      <box paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}>
        <input
          value={filter()}
          placeholder="filter..."
          placeholderColor="#8b949e"
          textColor="#e6edf3"
          backgroundColor="#0d1117"
          cursorColor="#e6edf3"
          width="100%"
          focused={true}
          ref={(node) => {
            input = node
          }}
          onInput={(v) => setFilter(v)}
        />
      </box>
      <scrollbox
        height={Math.min(6, items().length || 1)}
        scrollY={true}
        paddingLeft={2}
        paddingRight={2}
        paddingBottom={1}
      >
        <Index each={items()}>
          {(item, index) => (
            <box
              backgroundColor={index === selected() ? "#1f6feb" : undefined}
              paddingLeft={1}
              paddingRight={1}
              flexDirection="row"
              onMouseMove={() => setSelected(index)}
              onMouseDown={() => { setSelected(index); confirm() }}
            >
              <Show when={item().id === props.current} fallback={
                <text style={{ fg: index === selected() ? "#ffffff" : "#e6edf3" }}>{item().id}</text>
              }>
                <b>
                  <text style={{ fg: index === selected() ? "#ffffff" : "#58a6ff" }}>{item().id}</text>
                </b>
              </Show>
              <text style={{ fg: index === selected() ? "#c9d1d9" : "#8b949e" }} wrapMode="none">
                {"  "}{item().name}
              </text>
            </box>
          )}
        </Index>
        <Show when={items().length === 0}>
          <text style={{ fg: "#8b949e" }}>no providers match</text>
        </Show>
      </scrollbox>
    </box>
  )
}
