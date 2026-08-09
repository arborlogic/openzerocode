/**
 * MarkdownWithDiff — renders markdown with proper diff visualization.
 *
 * Detects ```diff / ```patch fenced code blocks in markdown content and
 * renders them using OpenTUI's native <diff> renderable with syntax
 * highlighting, line numbers, and proper added/removed line colors.
 *
 * Rendering strategy:
 *  - Streaming output uses an unstyled native <text> renderable. Updating a
 *    styled MarkdownRenderable for every token causes terminal repaint
 *    flicker, while plain text updates remain stable.
 *  - When streaming ends, the plain text renderable is replaced once with the
 *    fully styled Markdown renderer.
 *  - Completed content that contains a custom diff/table uses segmented
 *    rendering (parseDiffBlocks + <Index>).
 */

import { Index, Show, createMemo, type ComponentProps } from "solid-js"
import type { SyntaxStyle } from "@opentui/core"
import { parseDiffBlocks, type MarkdownDiffSegment } from "./markdown-diff-parser"
import { DIFF_RENDER_PROPS } from "./diff-rendering"
import { THEME } from "./theme"
import stringWidth from "string-width"

export { parseDiffBlocks } from "./markdown-diff-parser"

export function requiresCustomMarkdownRenderer(segments: MarkdownDiffSegment[]): boolean {
  return segments.some((segment) => segment.type !== "markdown")
}

export const MAX_STYLED_MARKDOWN_BLOCKS = 160
export const MAX_CUSTOM_MARKDOWN_SEGMENTS = 48
export const MAX_CUSTOM_TABLE_ROWS = 120

export type MarkdownRenderMode = "markdown" | "custom" | "plain"

/** Avoid letting one generated response allocate an unbounded renderable tree. */
export function markdownRenderMode(
  content: string,
  segments: MarkdownDiffSegment[],
): MarkdownRenderMode {
  const structuralBlocks = content.match(/(?:^|\n)(?:\s*\n|#{1,6}\s|```|~~~|\s*[-*+]\s|\s*\d+[.)]\s|>\s)/g)?.length ?? 0
  if (structuralBlocks > MAX_STYLED_MARKDOWN_BLOCKS) return "plain"
  if (!requiresCustomMarkdownRenderer(segments)) return "markdown"

  const tableRows = segments.reduce(
    (total, segment) => total + (segment.type === "table" ? segment.table.rows.length + 1 : 0),
    0,
  )
  if (segments.length > MAX_CUSTOM_MARKDOWN_SEGMENTS || tableRows > MAX_CUSTOM_TABLE_ROWS) return "plain"
  return "custom"
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

/**
 * Renders markdown content, replacing ```diff / ```patch blocks with
 * a native diff visualization.
 */
export function MarkdownWithDiff(props: MarkdownWithDiffProps) {
  const segments = createMemo(() =>
    props.streaming ? [] : parseDiffBlocks(props.content),
  )
  const renderMode = createMemo<MarkdownRenderMode>(() =>
    props.streaming ? "plain" : markdownRenderMode(props.content, segments()),
  )

  return (
    <box flexDirection="column" width="100%">
      <Show
        when={renderMode() === "plain"}
        fallback={
          <Show
            when={renderMode() === "custom"}
            fallback={
              <markdown
                content={props.content}
                syntaxStyle={props.syntaxStyle}
                fg={props.fg}
                bg={props.bg}
                streaming={false}
                internalBlockMode="top-level"
              />
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
        }
      >
        <text content={props.content} />
      </Show>
    </box>
  )
}
