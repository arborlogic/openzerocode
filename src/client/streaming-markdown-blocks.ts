import { marked } from "marked"

export interface StreamingMarkdownPartition {
  completed: string[]
  pending: string
}

/**
 * Reference links can be resolved by a definition that arrives much later in
 * the document. Such a definition changes how an earlier block is tokenized,
 * so that content cannot safely be frozen independently.
 */
function hasDocumentScopedReference(content: string): boolean {
  // The negative lookahead excludes ordinary inline links (`[text](url)`).
  // Full, collapsed, and shortcut references remain conservatively pending.
  const referenceUse = /!?(?:\[[^\]\n]+\])?\[[^\]\n]*\](?!\s*\()/
  const referenceDefinition = /^ {0,3}\[[^\]\n]+\]:\s*\S+/m
  const withoutTaskMarkers = content.replace(
    /^ {0,3}(?:[-+*]|\d+[.)])\s+\[[ xX]\]\s/gm,
    "",
  )
  return referenceUse.test(withoutTaskMarkers) || referenceDefinition.test(content)
}

/**
 * Split incrementally received Markdown at lexer-recognized top-level block
 * boundaries. The final block stays pending until another block starts, so a
 * later chunk cannot change a renderable that has already been finalized.
 */
export function partitionStreamingMarkdown(
  content: string,
  streaming: boolean,
): StreamingMarkdownPartition {
  if (!content) return { completed: [], pending: "" }

  // Keep document-scoped reference syntax in one render unit. Otherwise a
  // block such as `[label][id]` could be frozen as literal text before a later
  // `[id]: URL` definition arrives. This uncommon fallback sacrifices only
  // that document's prefix stabilization in exchange for correct Markdown.
  if (hasDocumentScopedReference(content)) {
    return streaming
      ? { completed: [], pending: content }
      : { completed: [content], pending: "" }
  }

  const groups: string[] = []
  for (const token of marked.lexer(content)) {
    const raw = token.raw ?? ""
    if (token.type === "space" && groups.length > 0) {
      groups[groups.length - 1] += raw
    } else if (raw) {
      groups.push(raw)
    }
  }

  // Be lossless if the lexer ever omits input it does not recognize.
  const parsedLength = groups.reduce((length, group) => length + group.length, 0)
  if (parsedLength < content.length) {
    const remainder = content.slice(parsedLength)
    if (groups.length > 0) groups[groups.length - 1] += remainder
    else groups.push(remainder)
  }

  if (!streaming) return { completed: groups, pending: "" }
  if (groups.length === 0) return { completed: [], pending: content }

  return {
    completed: groups.slice(0, -1),
    pending: groups[groups.length - 1]!,
  }
}
