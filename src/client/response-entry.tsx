import { createSignal, Show, createMemo } from "solid-js"
import { THEME, MARKDOWN_SYNTAX } from "./theme"
import { MarkdownWithDiff } from "./markdown-with-diff"
import { formatToolCallInput, formatToolResultPreview, tryParseJSON, detectFiletype } from "./format-utils"
import type { DisplayBlock } from "./display-block"

export type { DisplayBlock } from "./display-block"

// Collapsible thresholds
const TOOL_COLLAPSE_MAX_LINES = 3
const TOOL_COLLAPSE_MAX_LINE_LENGTH = 120
const BASH_COLLAPSE_MAX_LINES = 10

function displayLines(content: string) {
  if (!content) return []
  return content.replace(/\n$/, "").split("\n")
}

function hasLongDisplayLine(content: string) {
  return displayLines(content).some((line) => line.length > TOOL_COLLAPSE_MAX_LINE_LENGTH)
}

function stripAnsi(str: string) {
  return str.replace(/\x1b\[[0-9;]*m/g, "")
}

/** Detect filetype from content heuristics when no file path is available */
function detectFiletypeFromContent(content: string): string {
  const trimmed = content.trimStart()
  if (!trimmed) return "none"
  // JSON-like
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { JSON.parse(trimmed); return "json" } catch { /* not json */ }
  }
  // Shell-like
  if (trimmed.startsWith("$ ") || trimmed.startsWith("#!/")) return "bash"
  // Python-like
  if (/^(def |class |import |from )/.test(trimmed)) return "python"
  // TypeScript/JavaScript-like
  if (/^(const |let |var |function |import |export |interface |type )/.test(trimmed)) return "typescript"
  // Rust-like
  if (/^(fn |struct |enum |impl |pub |use |mod )/.test(trimmed)) return "rust"
  // Go-like
  if (/^(func |package |import )/.test(trimmed)) return "go"
  return "none"
}

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
      <box marginTop={props.isFirst ? 0 : 1} backgroundColor={THEME.background}>
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

  // Tool-call: detect filetype from file path
  const toolCallFiletype = createMemo(() => {
    if (props.entry.kind !== "tool-call") return "none"
    const filePath = (props.entry.meta as Record<string, unknown> | undefined)?.filePath
    if (typeof filePath === "string") return detectFiletype(filePath)
    return "json"
  })

  // Tool-call content: bash shows command, others show input
  const toolCallContent = createMemo(() => {
    if (props.entry.kind !== "tool-call") return ""
    if (isBashCall) {
      const parsed = tryParseJSON(props.entry.text)
      return typeof parsed.command === "string" ? `$ ${parsed.command}` : props.entry.text
    }
    return props.entry.text
  })

  // Tool-call collapse: bash >10 lines, others >3 lines
  const toolCallLines = createMemo(() => displayLines(toolCallContent()))
  const toolCallOverflow = createMemo(() => {
    if (isBashCall) return toolCallLines().length > BASH_COLLAPSE_MAX_LINES
    return toolCallLines().length > TOOL_COLLAPSE_MAX_LINES || hasLongDisplayLine(toolCallContent())
  })

  // Tool result: detect filetype from content heuristics
  const toolResultFiletype = createMemo(() => {
    if (props.entry.kind !== "tool") return "none"
    return detectFiletypeFromContent(props.entry.text)
  })

  // Tool result collapse: >3 lines or long lines
  const toolResultLines = createMemo(() => displayLines(props.entry.text))
  const toolResultOverflow = createMemo(() =>
    toolResultLines().length > TOOL_COLLAPSE_MAX_LINES || hasLongDisplayLine(props.entry.text)
  )

  // Whether to show expanded content
  const showExpanded = createMemo(() => {
    if (props.entry.streaming) return true
    if (props.entry.kind === "tool-call") return !toolCallOverflow() || !collapsed()
    if (props.entry.kind === "tool") return !toolResultOverflow() || !collapsed()
    return true
  })

  // Whether to show expand/collapse affordance for tool entries.
  const showExpandHint = createMemo(() => {
    if (props.entry.streaming) return false
    if (props.entry.kind === "tool-call" && toolCallOverflow()) return true
    if (props.entry.kind === "tool" && toolResultOverflow()) return true
    return false
  })

  const canToggle = createMemo(() => props.entry.kind === "reasoning" || showExpandHint())

  return (
    <box marginTop={props.isFirst ? 0 : 1} flexDirection="column" gap={1}>
      {/* Header row */}
      <box
        flexDirection="row"
        gap={1}
        onMouseDown={() => canToggle() && setCollapsed(c => !c)}
      >
        <Show when={canToggle()}>
          <text style={{ fg: labelColor() }}>{collapsed() ? "▸" : "▾"}</text>
        </Show>
        <text style={{ fg: labelColor() }}>{toolIcon}</text>
        <text style={{ fg: labelColor() }}>{toolLabel}</text>
        <Show when={props.entry.streaming}>
          <text style={{ fg: THEME.muted }}> …</text>
        </Show>
        <Show when={showExpandHint() && collapsed() && collapsedPreview()}>
          <text style={{ fg: THEME.muted }}>· {collapsedPreview()}</text>
        </Show>
        <Show when={showExpandHint() && collapsed()}>
          <text style={{ fg: THEME.muted }}>
            · click to expand ({toolResultLines().length || toolCallLines().length} lines)
          </text>
        </Show>
      </box>

      {/* Expanded body */}
      <Show when={showExpanded()}>
        <box paddingLeft={2}>
          {/* Bash tool-call: show command with syntax highlighting */}
          <Show when={isBashCall && !props.entry.streaming}>
            <code
              content={toolCallContent()}
              filetype="bash"
              syntaxStyle={MARKDOWN_SYNTAX}
              fg={THEME.text}
              drawUnstyledText={true}
            />
          </Show>

          {/* Non-bash tool-call: show input with syntax highlighting */}
          <Show when={props.entry.kind === "tool-call" && !isBashCall && !props.entry.streaming}>
            <code
              content={toolCallContent()}
              filetype={toolCallFiletype()}
              syntaxStyle={MARKDOWN_SYNTAX}
              fg={THEME.text}
              drawUnstyledText={true}
            />
          </Show>

          {/* Tool result: show output with syntax highlighting */}
          <Show when={props.entry.kind === "tool" && !props.entry.streaming}>
            <code
              content={props.entry.text}
              filetype={toolResultFiletype()}
              syntaxStyle={MARKDOWN_SYNTAX}
              fg={THEME.muted}
              drawUnstyledText={true}
            />
          </Show>

          {/* Error and streaming entries: plain text */}
          <Show when={props.entry.kind === "error" || !!props.entry.streaming}>
            <text style={{ fg: textColor() }}>{props.entry.text}</text>
          </Show>

          {/* Collapse hint when expanded */}
          <Show when={showExpandHint() && !collapsed()}>
            <text style={{ fg: THEME.muted }}>click to collapse</text>
          </Show>
        </box>
      </Show>
    </box>
  )
}
