import { SyntaxStyle } from "@opentui/core"

export const THEME = {
  background: "#0d1117",
  surface: "#161b22",
  panel: "#0d1117",
  border: "#30363d",
  text: "#e6edf3",
  muted: "#8b949e",
  accent: "#58a6ff",
  accentDim: "#1f6feb",
  user: "#7ee787",
  peer: "#f0883e",
  tool: "#d2a8ff",
  error: "#f85149",
  warning: "#d29922",
  headerBg: "#161b22",
  headerBorder: "#21262d",
  // Diff colors
  diffAddedBg: "#12261e",
  diffRemovedBg: "#2d1215",
  diffAddedSign: "#7ee787",
  diffRemovedSign: "#ff7b72",
  diffHunkSign: "#d2a8ff",
  diffLineNumberFg: "#8b949e",
}

export const MARKDOWN_SYNTAX = SyntaxStyle.fromTheme([
  { scope: ["default"], style: { foreground: THEME.text } },
  { scope: ["comment"], style: { foreground: THEME.muted, italic: true } },
  { scope: ["string"], style: { foreground: "#a5d6ff" } },
  { scope: ["keyword"], style: { foreground: THEME.accent, bold: true } },
  { scope: ["number"], style: { foreground: "#79c0ff" } },
  { scope: ["function"], style: { foreground: "#d2a8ff" } },
  { scope: ["type"], style: { foreground: "#ffa657" } },
])
// Register a paste-marker style for extmarks (orange badge like opencode)
MARKDOWN_SYNTAX.registerStyle("paste", {
  fg: THEME.background,
  bg: THEME.warning,
  bold: true,
})
