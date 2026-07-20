/**
 * MarkdownWithDiff — renders markdown with proper diff visualization.
 *
 * Detects ```diff / ```patch fenced code blocks in markdown content and
 * renders them using OpenTUI's native <diff> renderable with syntax
 * highlighting, line numbers, and proper added/removed line colors.
 *
 * Rendering strategy:
 *  - During ordinary Markdown streaming, each completed top-level block gets
 *    its own non-streaming Markdown renderable. Later chunks therefore update
 *    only the unfinished tail instead of invalidating the completed prefix.
 *  - The unfinished tail also uses Markdown, so headings and inline syntax do
 *    not temporarily appear as raw text.
 *  - Content that actually contains a custom diff/table switches to segmented
 *    rendering after completion. <Index> then keeps those segment identities
 *    stable across reactive re-evaluations of the parent.
 */

import { Index, Show, createMemo, type Accessor, type ComponentProps } from "solid-js"
import type { SyntaxStyle } from "@opentui/core"
import { parseDiffBlocks, type MarkdownDiffSegment } from "./markdown-diff-parser"
import { DIFF_RENDER_PROPS } from "./diff-rendering"
import { partitionStreamingMarkdown, type MarkdownBlock } from "./streaming-markdown-blocks"
import { THEME } from "./theme"
import stringWidth from "string-width"

export { parseDiffBlocks } from "./markdown-diff-parser"

export function requiresCustomMarkdownRenderer(segments: MarkdownDiffSegment[]): boolean {
  return segments.some((segment) => segment.type !== "markdown")
}

export interface MarkdownWithDiffProps extends ComponentProps<"div"> {
  content: string
  syntaxStyle: SyntaxStyle
  fg?: string
  bg?: string
  streaming?: boolean
  class?: string
}

function visibleWidth(text: string): number {
  try {
    return stringWidth(text)
  } catch {
    return text.length
  }
}

function padCell(text: string, width: number): string {
  const w = visibleWidth(text)
  if (w >= width) return text
  return text + " ".repeat(width - w)
}

function MarkdownTable(props: {
  table: { headers: string[]; rows: string[][] }
  fg?: string
  bg?: string
}) {
  const widths = createMemo(() => {
    const columnCount = props.table.headers.length
    return Array.from({ length: columnCount }, (_, index) => {
      const headerWidth = visibleWidth(props.table.headers[index] ?? "")
      const rowWidth = Math.max(
        0,
        ...props.table.rows.map((row) => visibleWidth(row[index] ?? "")),
      )
      return Math.max(3, headerWidth, rowWidth)
    })
  })

  const rowText = (cells: string[]) =>
    `│ ${widths().map((width, index) => padCell(cells[index] ?? "", width)).join(" │ ")} │`

  const separator = createMemo(() =>
    `├${widths().map((width) => "─".repeat(width + 2)).join("┼")}┤`,
  )

  const top = createMemo(() =>
    `┌${widths().map((width) => "─".repeat(width + 2)).join("┬")}┐`,
  )

  const bottom = createMemo(() =>
    `└${widths().map((width) => "─".repeat(width + 2)).join("┴")}┘`,
  )

  return (
    <box flexDirection="column" width="100%" marginTop={1} marginBottom={1}>
      <text content={top()} fg={props.fg} bg={props.bg} wrapMode="none" />
      <text content={rowText(props.table.headers)} fg={props.fg} bg={props.bg} wrapMode="none" />
      <text content={separator()} fg={props.fg} bg={props.bg} wrapMode="none" />
      {props.table.rows.map((row) => (
        <text content={rowText(row)} fg={props.fg} bg={props.bg} wrapMode="none" />
      ))}
      <text content={bottom()} fg={props.fg} bg={props.bg} wrapMode="none" />
    </box>
  )
}

function StableMarkdownBlock(props: {
  content: string
  syntaxStyle: SyntaxStyle
  fg?: string
  bg?: string
}) {
  return (
    <box backgroundColor={THEME.blockBg} padding={1} width="100%">
      <markdown
        content={props.content}
        syntaxStyle={props.syntaxStyle}
        fg={props.fg}
        bg={props.bg}
        streaming={false}
        internalBlockMode="top-level"
      />
    </box>
  )
}

/**
 * Renders markdown content, replacing ```diff / ```patch blocks with
 * a native diff visualization.
 */
export function MarkdownWithDiff(props: MarkdownWithDiffProps) {
  const segments = createMemo(() =>
    props.streaming ? [] : parseDiffBlocks(props.content, false),
  )

  const ordinaryBlocks = createMemo(() =>
    partitionStreamingMarkdown(props.content, props.streaming ?? false),
  )

  // During streaming, detect diff/table blocks in completed blocks so
  // hasCustomSegments is stable before streaming ends. This prevents the
  // <Show> condition from flipping at the streaming→completed transition.
  const streamingHasCustomSegments = createMemo(() => {
    if (!props.streaming) return false
    return ordinaryBlocks().completed.some((block) => {
      const trimmed = block.content.trimStart()
      if (/^```(?:diff|patch)\b/.test(trimmed)) return true
      if (/\|/.test(block.content) && /^\|?\s*[-:]+[-|:\s]*$/m.test(block.content)) return true
      return false
    })
  })

  const hasCustomSegments = createMemo(() =>
    props.streaming ? streamingHasCustomSegments() : requiresCustomMarkdownRenderer(segments()),
  )

  // Always use the ordinary-blocks path during streaming so that the
  // hasCustomSegments=true state does not hide content while segments()
  // is still empty. The switch to the segments path happens atomically
  // when streaming ends.
  const showOrdinaryPath = createMemo(() => props.streaming || !hasCustomSegments())

  return (
    <box flexDirection="column" width="100%" gap={1}>
      <Show
        when={showOrdinaryPath()}
        fallback={
          <Index each={segments()}>
            {(segment) => {
              const seg = segment()
              if (seg.type === "diff") {
                return (
                  <diff
                    diff={seg.content}
                    syntaxStyle={props.syntaxStyle}
                    fg={props.fg}
                    filetype="diff"
                    view="split"
                    showLineNumbers={true}
                    lineNumberFg={THEME.diffLineNumberFg}
                    addedBg={THEME.diffAddedBg}
                    removedBg={THEME.diffRemovedBg}
                    {...DIFF_RENDER_PROPS}
                    addedSignColor={THEME.diffAddedSign}
                    removedSignColor={THEME.diffRemovedSign}
                    marginTop={1}
                    marginBottom={1}
                    wrapMode="none"
                  />
                )
              }
              if (seg.type === "table") {
                return <MarkdownTable table={seg.table} fg={props.fg} bg={props.bg} />
              }
              return (
                <box backgroundColor={THEME.blockBg} padding={1} width="100%">
                  <markdown
                    content={seg.content}
                    syntaxStyle={props.syntaxStyle}
                    fg={props.fg}
                    bg={props.bg}
                    streaming={false}
                    internalBlockMode="top-level"
                  />
                </box>
              )
            }}
          </Index>
        }
      >
        <>
          <Index each={ordinaryBlocks().completed}>
            {(block) => (
              <Show
                when={block().type === "markdown"}
                fallback={
                  <box backgroundColor={THEME.blockBg} padding={1} width="100%">
                    <text content={block().content} fg={props.fg} bg={props.bg} />
                  </box>
                }
              >
                <StableMarkdownBlock
                  content={block().content}
                  syntaxStyle={props.syntaxStyle}
                  fg={props.fg}
                  bg={props.bg}
                />
              </Show>
            )}
          </Index>
          <Show when={ordinaryBlocks().pending}>
            {(pending: Accessor<MarkdownBlock>) => (
              <StableMarkdownBlock
                content={pending().content}
                syntaxStyle={props.syntaxStyle}
                fg={props.fg}
                bg={props.bg}
              />
            )}
          </Show>
        </>
      </Show>
    </box>
  )
}
