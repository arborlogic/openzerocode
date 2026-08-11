import { resolve, dirname, basename } from "node:path"
import { existsSync, readdirSync, statSync } from "node:fs"
import stringWidth from "string-width"

export function homeDir() {
  return process.env.HOME ?? ""
}

export function expandHome(path: string) {
  if (path === "~") return homeDir()
  if (path.startsWith("~/")) return resolve(homeDir(), path.slice(2))
  return path
}

export function displayPath(path: string) {
  const home = homeDir()
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path
}

function truncateStart(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ""
  if (stringWidth(text) <= maxWidth) return text
  let width = 1
  let result = ""
  for (const char of [...text].reverse()) {
    const charWidth = stringWidth(char)
    if (width + charWidth > maxWidth) break
    width += charWidth
    result = char + result
  }
  return "…" + result
}

/** Shorten a path from the left without dropping a leading ~/ marker. */
export function truncateDisplayPath(path: string, maxWidth: number): string {
  const displayed = displayPath(path)
  if (!displayed.startsWith("~/") || stringWidth(displayed) <= maxWidth) {
    return truncateStart(displayed, maxWidth)
  }
  if (maxWidth <= 4) return truncateStart(displayed, maxWidth)
  const tail = truncateStart(displayed.slice(2), maxWidth - 4).slice(1)
  return `~/…/${tail}`
}

export function resolveDirectoryPath(input: string, cwd = process.cwd()) {
  const expanded = expandHome(input.trim())
  return resolve(cwd, expanded || ".")
}

export function isDirectory(path: string) {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}

export function directoryCandidates(input: string, cwd = process.cwd()) {
  const raw = input.trim()
  const expanded = expandHome(raw)
  const target = expanded ? resolve(cwd, expanded) : cwd
  const inputEndsWithSeparator = raw.endsWith("/") || raw.endsWith("\\")
  const base = raw && !inputEndsWithSeparator ? dirname(target) : target
  const filter = raw && !inputEndsWithSeparator ? basename(target).toLowerCase() : ""
  const entries: { name: string; path: string }[] = []

  if (!raw) entries.push({ name: "../", path: resolve(cwd, "..") })

  try {
    for (const dirent of readdirSync(base, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue
      if (dirent.name.startsWith(".") && !filter.startsWith(".")) continue
      if (filter && !dirent.name.toLowerCase().startsWith(filter)) continue
      entries.push({ name: `${dirent.name}/`, path: resolve(base, dirent.name) })
    }
  } catch {
    return entries
  }

  return entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 20)
}
