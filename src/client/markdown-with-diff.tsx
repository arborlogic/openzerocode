/**
 * MarkdownWithDiff — renders markdown with proper diff visualization.
 *
 * Detects ```diff / ```patch fenced code blocks in markdown content and
 * renders them using the @opentui <diff> component with red/green line
 * backgrounds, while the rest of the markdown is rendered normally.
 */

import { For, type ComponentProps } from "solid-js"
import type { SyntaxStyle } from "@opentui/core"

type Segment =
  | { type: "markdown"; content: string }
  | { type: "diff"; content: string; file?: string }

/**
 * Parse markdown content into segments: normal markdown vs ```diff/```patch blocks.
 */
export function parseDiffBlocks(content: string): Segment[] {
  const segments: Segment[] = []
  // Matches fenced code blocks with diff or patch language.
  // Group 1: language (diff/patch)
  // Group 2: optional filename hint on the same line
  // Group 3: the content inside the block
  const pattern = /```(diff|patch)\s*(\S*)\n([\s\S]*?)```/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(content)) !== null) {
    // Text before this diff block
    const before = content.slice(lastIndex, match.index)
    if (before) {
      segments.push({ type: "markdown", content: before })
    }

    const lang = match[1]!
    const filename = match[2] ?? ""
    const diffContent = match[3]!

    // Strip the leading/trailing diff header lines if present but keep the hunk
    // The <diff> component expects unified diff format starting from ---/+++
    let cleanDiff = diffContent.trimEnd()

    // If the block has a leading diff --git line, keep it; otherwise
    // the parser handles plain unified diff just fine.
    segments.push({
      type: "diff",
      content: cleanDiff,
      file: filename || undefined,
    })

    lastIndex = match.index + match[0].length
  }

  // Remaining text after last diff block
  const remaining = content.slice(lastIndex)
  if (remaining) {
    segments.push({ type: "markdown", content: remaining })
  }

  return segments
}

export interface MarkdownWithDiffProps extends ComponentProps<"div"> {
  content: string
  syntaxStyle: SyntaxStyle
  fg?: string
  bg?: string
  streaming?: boolean
  class?: string
}

/**
 * Renders markdown content, replacing ```diff / ```patch blocks with
 * a proper side-by-side or unified diff view.
 */
export function MarkdownWithDiff(props: MarkdownWithDiffProps) {
  const segments = () => parseDiffBlocks(props.content)

  return (
    <box flexDirection="column" width="100%">
      <For each={segments()}>
        {(segment) => {
          if (segment.type === "diff") {
            return (
              <box marginTop={1} marginBottom={1}>
                <diff
                  diff={segment.content}
                  view="unified"
                  showLineNumbers={true}
                  syntaxStyle={props.syntaxStyle}
                  fg={props.fg}
                  addedBg="#1a4d1a"
                  removedBg="#4d1a1a"
                  contextBg="transparent"
                  addedSignColor="#22c55e"
                  removedSignColor="#ef4444"
                  lineNumberFg="#6b7280"
                />
              </box>
            )
          }
          return (
            <markdown
              content={segment.content}
              syntaxStyle={props.syntaxStyle}
              fg={props.fg}
              bg={props.bg}
              streaming={props.streaming ?? false}
            />
          )
        }}
      </For>
    </box>
  )
}
