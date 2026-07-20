import { marked } from "marked"

export type BlockType = "markdown" | "text"

export interface MarkdownBlock {
  content: string
  type: BlockType
}

export interface StreamingMarkdownPartition {
  completed: MarkdownBlock[]
  pending: MarkdownBlock | null
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
 * Lightweight heuristic: does this block contain Markdown syntax that would
 * benefit from markdown rendering (syntax highlighting, heading styling, etc.)?
 * Blocks without markdown syntax can be rendered as a simple <text> element,
 * avoiding the overhead of tree-sitter parsing and markdown tree construction.
 *
 * This is intentionally conservative — it only classifies blocks as "markdown"
 * when they contain explicit syntax. Plain paragraphs fall through to "text"
 * since the renderer adds no visible benefit for them.
 */
export function looksLikeMarkdown(content: string): boolean {
  // Heading
  if (/^ {0,3}#{1,6}\s/.test(content)) return true
  // Setext heading
  if (/^.+\n {0,3}(?:=+|-+)\s*$/m.test(content)) return true
  // Fenced code block
  if (/^ {0,3}(?:`{3,}|~{3,})/.test(content)) return true
  // Indented code block
  if (/^(?: {4}|\t)\S/m.test(content)) return true
  // Unordered list
  if (/^[\s]*[-*+]\s/.test(content)) return true
  // Ordered list
  if (/^[\s]*\d+[.)]\s/.test(content)) return true
  // Blockquote
  if (/^>/.test(content)) return true
  // Horizontal rule
  if (/^[-*_]{3,}\s*$/.test(content)) return true
  // Table (pipe + separator line)
  if (/\|/.test(content) && /^\|?\s*[-:]+[-|:\s]*$/m.test(content)) return true
  // Inline markdown (bold, italic, code, links)
  if (/\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|~~[^~]+~~|!?\[[^\]]*\]\([^)]+\)/.test(content)) return true
  // Autolinks and bare URLs are parsed as links by marked.
  if (/<(?:https?:\/\/|mailto:)[^ >]+>|\b(?:https?:\/\/|www\.)[^\s<]+/.test(content)) return true
  // Inline/block HTML needs the Markdown renderer rather than a literal text node.
  if (/<\/?[A-Za-z][^>]*>/.test(content)) return true
  // Reference links [text][id] or [text][]
  if (/\[[^\]]+\]\[[^\]]*\]/.test(content)) return true
  // Reference definitions [id]: url
  if (/^\[[^\]]+\]:\s*\S+/m.test(content)) return true
  return false
}

function classifyBlock(raw: string): MarkdownBlock {
  return {
    content: raw,
    type: looksLikeMarkdown(raw) ? "markdown" : "text",
  }
}

/**
 * Split incrementally received Markdown at lexer-recognized top-level block
 * boundaries. The final block stays pending until another block starts, so a
 * later chunk cannot change a renderable that has already been finalized.
 *
 * Each block is classified as "markdown" or "text" based on a lightweight
 * heuristic. Plain text blocks are rendered as plain <text> elements instead
 * of going through the full markdown parser, reducing render overhead.
 */
export function partitionStreamingMarkdown(
  content: string,
  streaming: boolean,
): StreamingMarkdownPartition {
  if (!content) return { completed: [], pending: null }

  // Keep document-scoped reference syntax in one render unit. Otherwise a
  // block such as `[label][id]` could be frozen as literal text before a later
  // `[id]: URL` definition arrives. This uncommon fallback sacrifices only
  // that document's prefix stabilization in exchange for correct Markdown.
  if (hasDocumentScopedReference(content)) {
    const block = classifyBlock(content)
    return streaming
      ? { completed: [], pending: block }
      : { completed: [block], pending: null }
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

  if (!streaming) return { completed: groups.map(classifyBlock), pending: null }
  if (groups.length === 0) return { completed: [], pending: classifyBlock(content) }

  return {
    completed: groups.slice(0, -1).map(classifyBlock),
    pending: classifyBlock(groups[groups.length - 1]!),
  }
}
