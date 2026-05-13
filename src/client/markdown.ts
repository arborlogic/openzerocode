import { marked } from "marked"
import chalk from "chalk"

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
  // width of the box (not counting ┌ and ┐); leave room for role prefix + outer indent (~6 chars)
  const w = Math.max(24, Math.min(cols - 8, 96))
  const border = "#30363D"
  const langColor = "#8B949E"
  const codeColor = "#E6EDF3"

  let header: string
  if (lang) {
    const dashLen = Math.max(2, w - lang.length - 2)
    header =
      chalk.hex(border)("┌") +
      chalk.hex(border)("─".repeat(dashLen)) +
      " " + chalk.hex(langColor)(lang) + " " +
      chalk.hex(border)("┐")
  } else {
    header = chalk.hex(border)(`┌${"─".repeat(w)}┐`)
  }
  const footer = chalk.hex(border)(`└${"─".repeat(w)}┘`)
  const body = code.trimEnd().split("\n").map((l) =>
    chalk.hex(border)("│") + " " + chalk.hex(codeColor)(l),
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
        lines.push(chalk.dim("─".repeat(Math.min(40, (process.stdout.columns || 80) - 10))))
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
