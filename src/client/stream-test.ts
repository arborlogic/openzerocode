/**
 * Deterministic local content for exercising the streaming Markdown renderer.
 * This deliberately never reaches a provider, so it is safe to replay freely.
 */
export const STREAM_TEST_RESPONSE = `# Streaming Markdown / Diff Stress Test

This is a **local, deterministic** response emitted in fixed-size chunks. It never contacts a provider and therefore uses no model tokens. Use it to compare the behaviour of ordinary text, inline Markdown, long wrapped paragraphs, fenced code, tables, and a unified diff while the content is still growing.

## Expected behaviour

During streaming, all content is intentionally displayed as plain text so the terminal should not continuously repaint styled Markdown. When the simulation completes, the final response is retained in history and rendered once with complete Markdown, code highlighting, table formatting, and the native diff view.

- [x] Inline formatting: **bold**, *italic*, ~~strike-through~~, and \`inline code\`
- [x] A link: [OpenZeroCode](https://github.com/arborlogic/openzerocode)
- [x] Long paragraph wrapping without a provider round-trip
- [x] TypeScript syntax-highlight test after completion
- [x] Unified diff rendering test after completion

> A streaming renderer should append new cells without remounting the response body, shifting previous lines, or jumping the scroll position unexpectedly.
>
> This second quoted paragraph makes the block taller and ensures blank lines and wrapped text are present in the simulated chunks.

## Long paragraph

The following intentionally long paragraph is here to exercise terminal wrapping across several chunk boundaries. As the response grows, earlier characters should remain visually stable even when later chunks cause a line to wrap near the right edge of the response panel. The text includes **emphasis**, a \`small code fragment\`, and a [stable link](https://example.com/stream-test) so that the final rich render has multiple inline styles to apply at once.

## TypeScript example

\`\`\`ts
type StreamTestState = {
  chunksReceived: number
  complete: boolean
  renderedText: string
}

export function appendChunk(
  state: StreamTestState,
  chunk: string,
): StreamTestState {
  return {
    ...state,
    chunksReceived: state.chunksReceived + 1,
    renderedText: state.renderedText + chunk,
  }
}

export function finishStream(state: StreamTestState): StreamTestState {
  return { ...state, complete: true }
}
\`\`\`

The code fence above should stay as raw text while the simulation is active, then receive syntax highlighting only after the local stream finishes. This verifies that the completion transition does not leave stale cells behind.

## Summary table

| Area | While streaming | After completion | What to observe |
| --- | --- | --- | --- |
| Paragraphs | Plain text | Markdown | Stable wrapping |
| Inline syntax | Raw markers | Styled text | No continuous flash |
| Code fence | Raw fence | Highlighted code | One final transition |
| Diff fence | Raw fence | Native diff | Correct added/removed rows |
| Scroll position | Follows output | Remains at bottom | No sudden jump |

## Unified diff simulation

\`\`\`diff
diff --git a/src/client/markdown-with-diff.tsx b/src/client/markdown-with-diff.tsx
index 1a2b3c4..5d6e7f8 100644
--- a/src/client/markdown-with-diff.tsx
+++ b/src/client/markdown-with-diff.tsx
@@ -104,14 +104,27 @@ export function MarkdownWithDiff(props: MarkdownWithDiffProps) {
-  return <markdown content={props.content} streaming={props.streaming} />
+  if (props.streaming) {
+    return (
+      <text
+        content={props.content}
+        fg={props.fg}
+        bg={props.bg}
+      />
+    )
+  }
+
+  return (
+    <markdown
+      content={props.content}
+      syntaxStyle={props.syntaxStyle}
+      fg={props.fg}
+      bg={props.bg}
+      streaming={false}
+      internalBlockMode="top-level"
+    />
+  )
 }
\`\`\`

## Nested list

1. First simulated phase
   - Receive deterministic chunks
   - Batch updates through the normal stream state
   - Keep the transcript scrolled to the newest content
2. Completion phase
   - Move the complete content into assistant history
   - Replace plain streaming text with final rich Markdown
3. Verification phase
   - Run this slash command repeatedly
   - Toggle \`/thinking\` and \`/tools\` after completion
   - Check that the transcript remains visually stable

## Final tail

This is the last paragraph of the local fixture. It contains **final bold text**, *final italic text*, \`final inline code\`, and a final [link](https://example.com/final). Until the simulated stream ends, it should remain raw plain text along with the rest of this response. Once complete, the entire answer should format in a single final render without any network request or token cost.
`

/** Split text at a fixed size to make replay timing and snapshots reproducible. */
export function streamTestChunks(text = STREAM_TEST_RESPONSE, chunkSize = 48): string[] {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error("chunkSize must be a positive integer")
  const chunks: string[] = []
  for (let start = 0; start < text.length; start += chunkSize) chunks.push(text.slice(start, start + chunkSize))
  return chunks
}
