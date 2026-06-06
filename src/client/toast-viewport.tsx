import { For, Show } from "solid-js"
import type { CommandToastKind } from "./commands"
import { THEME } from "./theme"

type ToastKind = CommandToastKind

export type ToastItem = {
  id: number
  kind: ToastKind
  title: string
  text?: string
}

export function ToastViewport(props: { items: ToastItem[] }) {
  const tone = (kind: ToastKind) => {
    if (kind === "success") return { border: "#3fb950", title: "#7ee787", body: THEME.text, icon: "✓" }
    if (kind === "warning") return { border: "#d29922", title: "#f2cc60", body: THEME.text, icon: "!" }
    if (kind === "error") return { border: "#f85149", title: "#ff7b72", body: THEME.text, icon: "✗" }
    return { border: THEME.accent, title: "#79c0ff", body: THEME.text, icon: "i" }
  }

  return (
    <box
      position="absolute"
      top={1}
      right={2}
      width={44}
      zIndex={120}
      flexDirection="column"
      gap={1}
    >
      <For each={props.items}>
        {(item) => {
          const colors = tone(item.kind)
          return (
            <box
              flexDirection="column"
              border={["top", "left", "right", "bottom"]}
              borderColor={colors.border}
              backgroundColor={THEME.surface}
              paddingLeft={1}
              paddingRight={1}
              paddingTop={0}
              paddingBottom={0}
            >
              <box flexDirection="row" gap={1}>
                <text style={{ fg: colors.title }}>{colors.icon}</text>
                <text style={{ fg: colors.title }}>{item.title}</text>
              </box>
              <Show when={item.text}>
                <text style={{ fg: colors.body }}>{item.text}</text>
              </Show>
            </box>
          )
        }}
      </For>
    </box>
  )
}
