import { createSignal, Show } from "solid-js"
import { THEME, MARKDOWN_SYNTAX } from "./theme"
import { MarkdownWithDiff } from "./markdown-with-diff"
import { formatToolCallInput, formatToolResultPreview, tryParseJSON } from "./format-utils"
import type { DisplayBlock } from "./display-block"

export type { DisplayBlock } from "./display-block"

export function ResponseEntry(props: { entry: DisplayBlock; isFirst: boolean }) {
  const collapsible = () => props.entry.kind === "reasoning" || props.entry.kind === "tool-call" || props.entry.kind === "tool"
  const [collapsed, setCollapsed] = createSignal(
    collapsible() && !(props.entry.streaming ?? false)
  )

  const labelColor = () => props.entry.kind === "user" ? THEME.user
    : props.entry.kind === "reasoning" ? THEME.accent
    : props.entry.kind === "tool" || props.entry.kind === "tool-call" ? THEME.tool
    : props.entry.kind === "error" ? THEME.error
    : THEME.muted

  const textColor = () => props.entry.kind === "reasoning" || props.entry.kind === "system" ? THEME.muted : THEME.text

  const collapsedPreview = () => {
    if (props.entry.kind === "tool-call" && props.entry.title) {
      return formatToolCallInput(props.entry.title, props.entry.text)
    }
    if (props.entry.kind === "tool") {
      return formatToolResultPreview(props.entry.text)
    }
    return ""
  }

  if (props.entry.kind === "assistant") {
    return (
      <box marginTop={props.isFirst ? 0 : 1}>
        <MarkdownWithDiff
          content={props.entry.text}
          syntaxStyle={MARKDOWN_SYNTAX}
          fg={THEME.text}
          bg={THEME.background}
          streaming={props.entry.streaming ?? false}
        />
      </box>
    )
  }

  if (props.entry.kind === "system") {
    return (
      <box marginTop={props.isFirst ? 0 : 1}>
        <text style={{ fg: textColor() }}>{props.entry.text}</text>
      </box>
    )
  }

  if (props.entry.kind === "reasoning") {
    return (
      <box marginTop={props.isFirst ? 0 : 1} flexDirection="column" gap={1}>
        {/* Thinking header — always shown, click to toggle */}
        <box
          flexDirection="row"
          gap={1}
          onMouseDown={() => setCollapsed(c => !c)}
        >
          <text style={{ fg: labelColor() }}>{collapsed() ? "▸" : "▾"}</text>
          <text style={{ fg: labelColor() }}>Thinking</text>
          <Show when={props.entry.streaming}>
            <text style={{ fg: THEME.muted }}> …</text>
          </Show>
          <Show when={collapsed() && !props.entry.streaming}>
            <text style={{ fg: THEME.muted }}>· {props.entry.text.split("\n")[0]}</text>
          </Show>
        </box>
        {/* Body — hidden when collapsed */}
        <Show when={!collapsed()}>
          <text style={{ fg: THEME.muted }}>{props.entry.text}</text>
        </Show>
      </box>
    )
  }

  /* tool-call and tool entries */
  const isBashCall = props.entry.kind === "tool-call" && props.entry.title === "bash"
  const toolIcon = props.entry.kind === "tool" ? "✓" : props.entry.kind === "error" ? "✗" : "■"
  const toolLabel = props.entry.title ?? (props.entry.kind === "tool" ? "result" : "tool")

  return (
    <box marginTop={props.isFirst ? 0 : 1} flexDirection="column" gap={1}>
      {/* Header row */}
      <box
        flexDirection="row"
        gap={1}
        onMouseDown={() => collapsible() && setCollapsed(c => !c)}
      >
        <Show when={collapsible()}>
          <text style={{ fg: labelColor() }}>{collapsed() ? "▸" : "▾"}</text>
        </Show>
        <text style={{ fg: labelColor() }}>{toolIcon}</text>
        <text style={{ fg: labelColor() }}>{toolLabel}</text>
        <Show when={props.entry.streaming}>
          <text style={{ fg: THEME.muted }}> …</text>
        </Show>
        <Show when={collapsed() && collapsedPreview()}>
          <text style={{ fg: THEME.muted }}>· {collapsedPreview()}</text>
        </Show>
      </box>

      {/* Expanded body */}
      <Show when={!collapsed()}>
        <box paddingLeft={2}>
          <Show when={isBashCall && !props.entry.streaming}>
            <text style={{ fg: textColor() }}>
              {(() => {
                const parsed = tryParseJSON(props.entry.text)
                return typeof parsed.command === "string"
                  ? `$ ${parsed.command}`
                  : props.entry.text
              })()}
            </text>
          </Show>
          <Show when={props.entry.kind === "tool" && !props.entry.streaming}>
            <text style={{ fg: THEME.muted }}>
              {(() => {
                const lines = props.entry.text.split("\n")
                const preview = lines.slice(0, 20).join("\n")
                return lines.length > 20 ? `${preview}\n… (${lines.length - 20} more lines)` : preview
              })()}
            </text>
          </Show>
          <Show when={(props.entry.kind !== "tool" && !isBashCall) || !!props.entry.streaming}>
            <text style={{ fg: textColor() }}>{props.entry.text}</text>
          </Show>
        </box>
      </Show>
    </box>
  )
}
