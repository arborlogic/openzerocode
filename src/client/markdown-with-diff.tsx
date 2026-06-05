/**
 * MarkdownWithDiff — renders markdown with proper diff visualization.
 *
 * Detects ```diff / ```patch fenced code blocks in markdown content and
 * renders them using the @opentui <diff> component with red/green line
 * backgrounds, while the rest of the markdown is rendered normally.
 */

import { For, type ComponentProps } from "solid-js"
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

/**
 * Renders markdown content, replacing ```diff / ```patch blocks with
 * a proper side-by-side or unified diff view.
 */
export function MarkdownWithDiff(props: MarkdownWithDiffProps) {
  const segments = () => parseDiffBlocks(props.content, props.streaming ?? false)

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
