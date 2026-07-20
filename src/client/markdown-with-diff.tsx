/**
 * MarkdownWithDiff — renders markdown with proper diff visualization.
 *
 * Detects ```diff / ```patch fenced code blocks in markdown content and
 * renders them using OpenTUI's native <diff> renderable with syntax
 * highlighting, line numbers, and proper added/removed line colors.
 *
 * Rendering strategy (unified render list):
 *  - A single <Index> renders all content as RenderUnits, regardless of
 *    whether we are streaming or completed. This eliminates the <Show>
 *    path-switch that caused the old ordinary-blocks ↔ segments unmount/remount
 *    flicker at the streaming→completed transition.
 *  - During streaming, the render list is built from ordinary blocks
 *    (completed + pending). After streaming ends, it is rebuilt from
 *    parseDiffBlocks segments (markdown + diff + table).
 *  - SolidJS <Index> diffs by position, so items that keep the same index
 *    are reused without remounting — only changed positions are
 *    unmounted/remounted.
 */

import { Index, Show, createMemo, type Accessor, type ComponentProps } from "solid-js"
import type { SyntaxStyle } from "@opentui/core"
import { parseDiffBlocks } from "./markdown-diff-parser"
import { DIFF_RENDER_PROPS } from "./diff-rendering"
import { partitionStreamingMarkdown, type MarkdownBlock } from "./streaming-markdown-blocks"
import { THEME } from "./theme"
import stringWidth from "string-width"

export { parseDiffBlocks } from "./markdown-diff-parser"

export function requiresCustomMarkdownRenderer(segments: { type: string }[]): boolean {
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

/** Discriminated union for the unified render list. */
type RenderUnit =
  | { kind: "markdown"; content: string }
  | { kind: "text"; content: string }
  | { kind: "diff"; content: string }
  | { kind: "table"; table: { headers: string[]; rows: string[][] } }

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

function RenderUnitView(props: {
  unit: Accessor<RenderUnit>
  syntaxStyle: SyntaxStyle
  fg?: string
  bg?: string
}) {
  const diff = () => {
    const unit = props.unit()
    return unit.kind === "diff" ? unit : undefined
  }
  const table = () => {
    const unit = props.unit()
    return unit.kind === "table" ? unit : undefined
  }

  return (
    <Show
      when={diff()}
      fallback={
        <Show
          when={table()}
          fallback={
            <box backgroundColor={THEME.blockBg} padding={1} width="100%">
              <Show
                when={props.unit().kind === "markdown"}
                fallback={
                  <text
                    content={(props.unit() as Extract<RenderUnit, { kind: "text" }>).content}
                    fg={props.fg}
                    bg={props.bg}
                  />
                }
              >
                <markdown
                  content={(props.unit() as Extract<RenderUnit, { kind: "markdown" }>).content}
                  syntaxStyle={props.syntaxStyle}
                  fg={props.fg}
                  bg={props.bg}
                  streaming={false}
                  internalBlockMode="top-level"
                />
              </Show>
            </box>
          }
        >
          {(currentTable: Accessor<Extract<RenderUnit, { kind: "table" }>>) => (
            <MarkdownTable table={currentTable().table} fg={props.fg} bg={props.bg} />
          )}
        </Show>
      }
    >
      {(currentDiff: Accessor<Extract<RenderUnit, { kind: "diff" }>>) => (
        <diff
          diff={currentDiff().content}
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
      )}
    </Show>
  )
}

/**
 * Renders markdown content, replacing ```diff / ```patch blocks with
 * a native diff visualization.
 */
export function MarkdownWithDiff(props: MarkdownWithDiffProps) {
  const ordinaryBlocks = createMemo(() =>
    partitionStreamingMarkdown(props.content, props.streaming ?? false),
  )

  const segments = createMemo(() =>
    props.streaming ? [] : parseDiffBlocks(props.content, false),
  )

  // Unified render list: during streaming → ordinary blocks; after streaming → segments.
  // The <Index> diffs by position, so only changed slots are unmounted/remounted.
  const renderUnits = createMemo<RenderUnit[]>(() => {
    if (!props.streaming && segments().length > 0) {
      // After streaming ends with segments (may include diff/table)
      return segments().map((seg) => {
        if (seg.type === "diff") return { kind: "diff" as const, content: seg.content }
        if (seg.type === "table") return { kind: "table" as const, table: seg.table }
        return { kind: "markdown" as const, content: seg.content }
      })
    }
    // During streaming or no segments: ordinary blocks
    const units: RenderUnit[] = ordinaryBlocks().completed.map((block) => ({
      kind: block.type as "markdown" | "text",
      content: block.content,
    }))
    if (ordinaryBlocks().pending) {
      units.push({ kind: "markdown", content: ordinaryBlocks().pending!.content })
    }
    return units
  })

  return (
    <box flexDirection="column" width="100%" gap={1}>
      <Index each={renderUnits()}>
        {(unit) => (
          <RenderUnitView
            unit={unit}
            syntaxStyle={props.syntaxStyle}
            fg={props.fg}
            bg={props.bg}
          />
        )}
      </Index>
    </box>
  )
}
