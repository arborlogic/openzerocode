import path from "node:path"
import { pathToFileURL } from "node:url"

const REPORT_PATH_LINE = /^(\s*(?:[-*]\s+)?(?:\*\*)?(?:Modified|Added|Deleted|Regenerated)(?::\*\*|\*\*:|:)\s*)([^\r\n]*?)(\s*)$/
const FENCE = /^\s*(`{3,}|~{3,})/

function markdownLinkLabel(path: string): string {
  return path.replace(/([\\\[\]])/g, "\\$1")
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
    const filePath = rawPath!.trim()
    if (!filePath || filePath.includes("\`") || filePath.includes("](") || /^[a-z][a-z\d+.-]*:/i.test(filePath)) {
      return part
    }

    const fileUrl = pathToFileURL(path.resolve(cwd, filePath)).href
    return `${prefix}[${markdownLinkLabel(filePath)}](<${fileUrl}>)${trailingWhitespace}`
  }).join("")
}
