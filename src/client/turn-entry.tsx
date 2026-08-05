import { Index, Show } from "solid-js"
import { THEME } from "./theme"
import { ResponseEntry } from "./response-entry"
import type { DisplayBlock } from "./response-entry"

export type DisplayTurn = {
  user?: DisplayBlock
  entries: DisplayBlock[]
  footer?: string
  omittedMountedBlocks?: number
  userMsgIndex?: number  // index into messages() so we can edit/truncate
  peerOrigin?: string    // set when this turn was sent by a peer process
}

export function TurnEntry(props: {
  turn: DisplayTurn
  isFirst: boolean
  onUserClick?: (msgIndex: number, text: string) => void
  isRunning?: boolean
}) {
  const canClick = () => !props.isRunning && props.turn.userMsgIndex !== undefined && !!props.onUserClick

  return (
    <box flexDirection="column" marginTop={props.isFirst ? 0 : 1} gap={1} backgroundColor={THEME.background} width="100%" minWidth={0}>
      <Show when={props.turn.user}>
        <box
          paddingLeft={2}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          border={["left"]}
          borderColor={props.turn.peerOrigin ? THEME.peer : THEME.user}
          onMouseDown={() => {
            if (canClick()) {
              props.onUserClick!(props.turn.userMsgIndex!, props.turn.user?.text ?? "")
            }
          }}
        >
          <Show when={props.turn.peerOrigin}>
            <text style={{ fg: THEME.peer }}>from: {props.turn.peerOrigin}</text>
          </Show>
          <box flexDirection="row" gap={1} width="100%" minWidth={0}>
            <text style={{ fg: THEME.text, flexGrow: 1 }}>{props.turn.user?.text ?? ""}</text>
            <Show when={canClick()}>
              <text style={{ fg: THEME.muted }}>⋯</text>
            </Show>
          </box>
        </box>
      </Show>

      <Show when={props.turn.entries.length > 0}>
        <box flexDirection="column">
          <Show when={(props.turn.omittedMountedBlocks ?? 0) > 0}>
            <text style={{ fg: THEME.muted }}>
              {`… ${props.turn.omittedMountedBlocks} older blocks unmounted from this tool-heavy turn`}
            </text>
          </Show>
          {/* Entries are append-only within a turn. Index keeps existing
              renderables mounted when messageToBlocks returns fresh objects.
              Hidden entries must remain in this indexed list: filtering them
              would shift later slots and make OpenTUI briefly repaint them
              with the preceding entry's content. */}
          <Index each={props.turn.entries}>
            {(entry, index) => (
              <Show when={!entry().hidden}>
                <ResponseEntry entry={entry()} isFirst={index === 0} />
              </Show>
            )}
          </Index>
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
