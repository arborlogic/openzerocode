import { For, Show } from "solid-js"
import { THEME } from "./theme"
import { ResponseEntry } from "./response-entry"
import type { DisplayBlock } from "./response-entry"

export type DisplayTurn = {
  user?: DisplayBlock
  entries: DisplayBlock[]
  footer?: string
  userMsgIndex?: number  // index into messages() so we can edit/truncate
}

export function TurnEntry(props: {
  turn: DisplayTurn
  isFirst: boolean
  onUserClick?: (msgIndex: number, text: string) => void
  isRunning?: boolean
}) {
  const canClick = () => !props.isRunning && props.turn.userMsgIndex !== undefined && !!props.onUserClick

  return (
    <box flexDirection="column" marginTop={props.isFirst ? 0 : 1} gap={1}>
      <Show when={props.turn.user}>
        <box
          paddingLeft={2}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          border={["left"]}
          borderColor={THEME.user}
          onMouseDown={() => {
            if (canClick()) {
              props.onUserClick!(props.turn.userMsgIndex!, props.turn.user?.text ?? "")
            }
          }}
        >
          <box flexDirection="row" gap={1}>
            <text style={{ fg: THEME.text, flexGrow: 1 }}>{props.turn.user?.text ?? ""}</text>
            <Show when={canClick()}>
              <text style={{ fg: THEME.muted }}>⋯</text>
            </Show>
          </box>
        </box>
      </Show>

      <Show when={props.turn.entries.length > 0}>
        <box flexDirection="column">
          <For each={props.turn.entries}>
            {(entry, index) => <ResponseEntry entry={entry} isFirst={index() === 0} />}
          </For>
          <Show when={props.turn.footer}>
            <box marginTop={1}>
              <text style={{ fg: THEME.muted }}>{props.turn.footer}</text>
            </box>
          </Show>
        </box>
      </Show>
    </box>
  )
}
