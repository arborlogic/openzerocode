import path from "node:path"
import { pathToFileURL } from "node:url"

const REPORT_PATH_LINE = /^(\s*(?:[-*]\s+)?(?:\*\*)?(?:Modified|Added|Deleted|Regenerated)(?::\*\*|\*\*:|:)\s*)([^\r\n]*?)(\s*)$/
const FENCE = /^\s*(`{3,}|~{3,})/
const MARKDOWN_LINK = /(\[[^\]\r\n]*\])\(\s*(?:<([^>\r\n]+)>|([^\s)\r\n]+))\s*\)/g

function markdownLinkLabel(path: string): string {
  return path.replace(/([\\\[\]])/g, "\\$1")
}

export function localFileUrl(filePath: string, cwd = process.cwd()): string | undefined {
  // Preserve web, file, anchor, and protocol-relative destinations. Only plain
  // filesystem paths should be redirected to the terminal's file opener.
  if (!filePath || /^(?:[a-z][a-z\d+.-]*:|#|\?|\/\/)/i.test(filePath)) return undefined
  return pathToFileURL(path.resolve(cwd, filePath)).href
}

function linkMarkdownFilePaths(content: string, cwd: string): string {
  return content.replace(MARKDOWN_LINK, (fullMatch, label: string, bracketedPath?: string, barePath?: string) => {
    const filePath = bracketedPath ?? barePath
    const fileUrl = filePath ? localFileUrl(filePath, cwd) : undefined
    return fileUrl ? `${label}(<${fileUrl}>)` : fullMatch
  })
}

/**
 * Turn paths in the standard completion report into local file hyperlinks.
 *
 * Markdown treats relative link destinations as web paths, which terminals
 * resolve as `http://…`. File URIs preserve the displayed relative path while
 * giving Cmd/Ctrl+Click an unambiguous local target.
 */
export function linkCompletionReportPaths(content: string, cwd = process.cwd()): string {
  let fence: "`" | "~" | undefined

  return content.split(/(\r?\n)/).map((part) => {
    // Keep line separators and fenced code untouched.
    if (part === "\n" || part === "\r\n") return part

    const fenceMatch = part.match(FENCE)
    if (fenceMatch) {
      const marker = fenceMatch[1]![0] as "`" | "~"
      if (!fence || fence === marker) fence = fence ? undefined : marker
      return part
    }
    if (fence) return part

    const match = part.match(REPORT_PATH_LINE)
    if (!match) return part

    const [, prefix, rawPath, trailingWhitespace] = match
    const reportContent = rawPath!.trim()
    if (!reportContent || reportContent.includes("`")) return part

    // Earlier responses used relative Markdown destinations. Rewrite those
    // existing links as well, or the terminal opens an HTTP URL instead.
    if (MARKDOWN_LINK.test(reportContent)) {
      // RegExp#test advances the cursor for global expressions.
      MARKDOWN_LINK.lastIndex = 0
      return `${prefix}${linkMarkdownFilePaths(reportContent, cwd)}${trailingWhitespace}`
    }

    const fileUrl = localFileUrl(reportContent, cwd)
    if (!fileUrl) return part
    return `${prefix}[${markdownLinkLabel(reportContent)}](<${fileUrl}>)${trailingWhitespace}`
  }).join("")
}
