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
import { partitionStreamingMarkdown } from "./streaming-markdown-blocks"
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
    <markdown
      content={props.content}
      syntaxStyle={props.syntaxStyle}
      fg={props.fg}
      bg={props.bg}
      streaming={false}
      internalBlockMode="top-level"
    />
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
  const hasCustomSegments = createMemo(() => requiresCustomMarkdownRenderer(segments()))
  const ordinaryBlocks = createMemo(() =>
    partitionStreamingMarkdown(props.content, props.streaming ?? false),
  )

  return (
    <box flexDirection="column" width="100%">
      <Show
        when={hasCustomSegments()}
        fallback={
          <>
            <Index each={ordinaryBlocks().completed}>
              {(block) => (
                <StableMarkdownBlock
                  content={block()}
                  syntaxStyle={props.syntaxStyle}
                  fg={props.fg}
                  bg={props.bg}
                />
              )}
            </Index>
            <Show when={ordinaryBlocks().pending}>
              {(pending: Accessor<string>) => (
                <StableMarkdownBlock
                  content={pending()}
                  syntaxStyle={props.syntaxStyle}
                  fg={props.fg}
                  bg={props.bg}
                />
              )}
            </Show>
          </>
        }
      >
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
              <markdown
                content={seg.content}
                syntaxStyle={props.syntaxStyle}
                fg={props.fg}
                bg={props.bg}
                streaming={false}
                internalBlockMode="top-level"
              />
            )
          }}
        </Index>
      </Show>
    </box>
  )
}
