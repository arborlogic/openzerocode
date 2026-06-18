/**
 * MarkdownWithDiff — renders markdown with proper diff visualization.
 *
 * Detects ```diff / ```patch fenced code blocks in markdown content and
 * renders them using a conservative inline text renderer with red/green
 * line colors, while the rest of the markdown is rendered normally.
 *
 * Rendering strategy:
 *  - While `streaming` is true we render the raw content through a single
 *    <markdown> renderable. Running parseDiffBlocks on every chunk and
 *    remounting <markdown>/<diff> via <For> caused the chat response to
 *    flicker (new object identities → mapArray rebuilds the whole subtree).
 *  - After streaming completes we parse diff blocks once and use <Index>
 *    (positional keys) so segment identities stay stable across reactive
 *    re-evaluations of the parent — completing a turn never remounts
 *    already-rendered diff/markdown blocks.
 *
 * Note: we intentionally do not use OpenTUI's <diff> renderable here.
 * Its line background can stick to the top of the scroll viewport while
 * scrolling completed chat history. A plain <text> per line avoids that
 * scrollback artifact while preserving readable + / - coloring.
 */

import { For, Index, Show, createMemo, type ComponentProps } from "solid-js"
import type { SyntaxStyle } from "@opentui/core"
import { parseDiffBlocks } from "./markdown-diff-parser"

export { parseDiffBlocks } from "./markdown-diff-parser"

export interface MarkdownWithDiffProps extends ComponentProps<"div"> {
  content: string
  syntaxStyle: SyntaxStyle
  fg?: string
  bg?: string
  streaming?: boolean
  class?: string
}

function DiffText(props: { content: string; fg?: string; bg?: string }) {
  const lines = createMemo(() => props.content.split("\n"))

  return (
    <box flexDirection="column" width="100%" marginTop={1} marginBottom={1}>
      <For each={lines()}>
        {(line) => {
          const color = line.startsWith("+") && !line.startsWith("+++")
            ? "#7ee787"
            : line.startsWith("-") && !line.startsWith("---")
              ? "#ff7b72"
              : line.startsWith("@@")
                ? "#d2a8ff"
                : props.fg

          return (
            <text
              content={line.length > 0 ? line : " "}
              fg={color}
              bg={props.bg}
              wrapMode="none"
            />
          )
        }}
      </For>
    </box>
  )
}

function visibleWidth(text: string): number {
  return text.length
}

function padCell(text: string, width: number): string {
  return `${text}${" ".repeat(Math.max(0, width - visibleWidth(text)))}`
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
      <text content={rowText(props.table.headers)} fg="#58a6ff" bg={props.bg} wrapMode="none" />
      <text content={separator()} fg={props.fg} bg={props.bg} wrapMode="none" />
      <For each={props.table.rows}>
        {(row) => <text content={rowText(row)} fg={props.fg} bg={props.bg} wrapMode="none" />}
      </For>
      <text content={bottom()} fg={props.fg} bg={props.bg} wrapMode="none" />
    </box>
  )
}

/**
 * Renders markdown content, replacing ```diff / ```patch blocks with
 * a unified diff-like text view.
 */
export function MarkdownWithDiff(props: MarkdownWithDiffProps) {
  // Memoize so segment objects are referentially stable for the lifetime
  // of this content — keeps <Index> happy and avoids spurious work.
  const segments = createMemo(() =>
    props.streaming ? [] : parseDiffBlocks(props.content, false),
  )

  return (
    <box flexDirection="column" width="100%">
      <Show
        when={props.streaming}
        fallback={
          // Completed content: parse once and render segments. <Index> keys
          // by position, so unchanged segments keep their renderable across
          // re-evaluations — a streaming → completion transition won't
          // remount the existing <markdown>/<diff> blocks.
          <Index each={segments()}>
            {(segment) => {
              const seg = segment()
              if (seg.type === "diff") {
                return <DiffText content={seg.content} fg={props.fg} bg={props.bg} />
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
                />
              )
            }}
          </Index>
        }
      >
        {
          // While streaming we deliberately skip parseDiffBlocks. The fenced
          // ```diff / ```patch blocks stay as fenced code blocks inside the
          // <markdown> renderable, which is updated in place by opentui as
          // the content grows. No <For>/<Index> remount happens, so the
          // visible output is stable across chunk flushes.
        }
        <markdown
          content={props.content}
          syntaxStyle={props.syntaxStyle}
          fg={props.fg}
          bg={props.bg}
          streaming={true}
        />
      </Show>
    </box>
  )
}
