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
  const line = chalk.hex("#4B5563")("─".repeat(Math.min(cols - 10, 60)))
  const header = lang ? `${chalk.hex("#4B5563")("┌")}${line} ${chalk.hex("#93A3B8")(lang)}` : `${chalk.hex("#4B5563")("┌")}${line}`
  const footer = `${chalk.hex("#4B5563")("└")}${line}`
  const body = code.split("\n").map((l) => chalk.hex("#4B5563")("│ ") + chalk.bgHex("#111827").hex("#E5E7EB")(l)).join("\n")
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
        lines.push("")
        break

      case "heading":
        const content = renderInline(t.tokens)
        lines.push("")
        lines.push(t.depth <= 2 ? chalk.hex("#E6EDF3").bold.underline(content) : chalk.hex("#E6EDF3").bold(content))
        lines.push("")
        break

      case "code":
        lines.push(renderCodeBlock(t.lang ?? undefined, t.text))
        break

      case "list":
        lines.push("")
        for (let i = 0; i < t.items.length; i++) {
          const item = t.items[i]
          const bullet = t.ordered ? `${(t.start ?? 1) + i}.` : "•"
          lines.push(`  ${chalk.hex("#7AA2F7")(bullet)} ${renderInline(item.tokens ?? [])}`)
        }
        lines.push("")
        break

      case "blockquote":
        lines.push("")
        for (const bt of t.tokens ?? []) {
          if (bt.type === "paragraph") {
            lines.push(chalk.hex("#7D8796")("│ ") + chalk.hex("#C9D1D9")(renderInline(bt.tokens)))
          }
        }
        lines.push("")
        break

      case "hr":
        lines.push(chalk.hex("#4B5563")("─".repeat(Math.min(56, (process.stdout.columns || 80) - 10))))
        lines.push("")
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

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()
  const normalized: string[] = []
  for (const line of lines) {
    if (line === "" && normalized[normalized.length - 1] === "") continue
    normalized.push(line)
  }
  return normalized.join("\n")
}
