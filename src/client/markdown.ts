import { marked } from "marked"
import chalk from "chalk"
import stringWidth from "string-width"

// Truncate plain (non-ANSI) text to a maximum visual width, appending "…" if cut.
function truncateToVisualWidth(text: string, maxWidth: number): string {
  if (stringWidth(text) <= maxWidth) return text
  let width = 0
  let result = ""
  for (const char of [...text]) {
    const cw = stringWidth(char)
    if (width + cw > maxWidth - 1) { result += "…"; break }
    width += cw
    result += char
  }
  return result
}

function renderInline(tokens: any[] | undefined): string {
  if (!tokens) return ""
  return tokens.map((t) => {
    switch (t.type) {
      case "text": return t.text
      case "strong": return chalk.bold(renderInline(t.tokens))
      case "em": return chalk.italic(renderInline(t.tokens))
      case "codespan": return chalk.cyan(t.text)
      case "br": return "\n"
      case "del": return chalk.strikethrough(renderInline(t.tokens))
      case "link": return chalk.underline(t.href ?? "")
      case "image": return chalk.dim(`[image: ${t.text}]`)
      default: return "raw" in t ? t.raw ?? "" : ""
    }
  }).join("")
}

function renderCodeBlock(lang: string | undefined, code: string): string {
  const cols = process.stdout.columns || 80
  // sidebar=34, outer padding=2, scrollbox padding=4, TurnEntry box padding+border=4 → 44 reserved
  // box header adds ┌ and ┐ (+2), body adds │ and space (+2) — keep w ≤ cols-46
  const w = Math.max(24, Math.min(cols - 46, 96))
  const border = "#30363D"
  const langColor = "#8B949E"
  const codeColor = "#E6EDF3"

  let header: string
  if (lang) {
    const langDisplay = truncateToVisualWidth(lang, w - 4)
    const dashLen = Math.max(2, w - stringWidth(langDisplay) - 2)
    header =
      chalk.hex(border)("┌") +
      chalk.hex(border)("─".repeat(dashLen)) +
      " " + chalk.hex(langColor)(langDisplay) + " " +
      chalk.hex(border)("┐")
  } else {
    header = chalk.hex(border)(`┌${"─".repeat(w)}┐`)
  }
  const footer = chalk.hex(border)(`└${"─".repeat(w)}┘`)
  const body = code.trimEnd().split("\n").map((l) =>
    chalk.hex(border)("│") + " " + chalk.hex(codeColor)(truncateToVisualWidth(l, w)),
  ).join("\n")
  return `\n${header}\n${body}\n${footer}\n`
}

export function renderMarkdown(text: string): string {
  const tokens = marked.lexer(text)
  const lines: string[] = []

  for (const t of tokens) {
    switch (t.type) {
      case "space":
        lines.push("")
        break

      case "paragraph":
        lines.push(renderInline(t.tokens))
        break

      case "heading":
        const content = renderInline(t.tokens)
        lines.push(t.depth <= 2 ? chalk.bold.underline(content) : chalk.bold(content))
        break

      case "code":
        lines.push(renderCodeBlock(t.lang ?? undefined, t.text))
        break

      case "list":
        for (let i = 0; i < t.items.length; i++) {
          const item = t.items[i]
          const bullet = t.ordered ? `${(t.start ?? 1) + i}.` : "•"
          lines.push(`  ${chalk.dim(bullet)} ${renderInline(item.tokens ?? [])}`)
        }
        break

      case "blockquote":
        for (const bt of t.tokens ?? []) {
          if (bt.type === "paragraph") {
            lines.push(chalk.dim("│ ") + renderInline(bt.tokens))
          }
        }
        break

      case "hr":
        lines.push(chalk.dim("─".repeat(Math.min(40, (process.stdout.columns || 80) - 48))))
        break

      case "table":
        for (const cell of t.header ?? []) {
          lines.push(chalk.bold(renderInline(cell.tokens)))
        }
        for (const row of t.rows ?? []) {
          for (const cell of row) {
            lines.push(renderInline(cell.tokens))
          }
        }
        break

      default:
        if ("raw" in t) lines.push((t as any).raw)
    }
  }

  return lines.join("\n")
}
