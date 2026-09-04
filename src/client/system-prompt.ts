import { existsSync, readdirSync, readFileSync } from "fs"
import { resolve, join } from "path"
import { homedir } from "os"
import type { RunMode } from "./session-runner"
import { isConnected } from "../browser/geass-client"
import { parse as parseYaml } from "yaml"

export type HarnessProfile = "productive" | "lite"

/**
 * The Lite harness is intentionally opt-in while its UI/preferences slice is
 * still under development. Invalid values preserve the existing prompt.
 */
export function getHarnessProfile(value = process.env.OPENZEROCODE_HARNESS_PROFILE): HarnessProfile {
  return value?.trim().toLowerCase() === "lite" ? "lite" : "productive"
}

/**
 * Lite mode has a strict context budget. Keep skill prompts out of every
 * runtime entry point, including instructions appended after the base prompt.
 */
export function shouldAppendSkillInstructions(harnessProfile = getHarnessProfile()): boolean {
  return harnessProfile !== "lite"
}

const LITE_WORKSPACE_INSTRUCTIONS_MAX_CHARS = 4_000

const TODO_INSTRUCTIONS = [
  "# Task List (todowrite tool)",
  "Use the todowrite tool to create and maintain a task list when:",
  "  - The task requires 3 or more distinct steps",
  "  - The user provides multiple things to do",
  "  - You need to make coordinated changes across several files",
  "Do NOT use todowrite for single-step or trivial tasks.",
  "",
  "Task lifecycle rules:",
  "  - Create the full list BEFORE starting work — one call with all tasks as 'pending'",
  "  - Mark a task 'in_progress' immediately before you begin it (only ONE in_progress at a time)",
  "  - Mark it 'completed' immediately after finishing it",
  "  - If a task turns out to be unnecessary, remove it from the list",
  "  - Update the list whenever your plan changes",
].join("\n")

const BASE_SYSTEM_PROMPT = [
  "You are OpenZeroCode, an AI coding assistant.",
  "You have access to tools for reading, writing, searching files and running shell commands.",
  "In Build mode, default to doing the work instead of only describing it.",
  "Unless the user explicitly asks for analysis, explanation, brainstorming, or a plan, assume they want you to inspect the codebase and make the requested change directly.",
  "When the user asks to create, modify, fix, refactor, or update code, docs, config, or tests, use the available tools to make the change in the workspace.",
  "Before editing, inspect the relevant implementation, tests, and repository conventions. Prefer the smallest complete change that fixes the root cause; do not broaden scope with unrelated refactors.",
  "Preserve existing behavior unless the request requires changing it. Add or update focused tests for observable behavior and regressions.",
  "After non-trivial changes, run the most relevant verification commands available in this repository.",
  "Treat tool output as evidence: read failures, correct the implementation, and rerun verification. Never claim success without fresh command results.",
  "For simple conversation or questions that do not require workspace changes, respond directly without tools.",
  "When the user mentions a URL, reference to documentation, or a package/library/framework you are not familiar with, use the web_fetch tool to retrieve the content. You can also use web_fetch to search the web (e.g., fetch https://www.google.com/search?q=...) when you need up-to-date information.",
  "Be concise and helpful.",
  "",
  "# Diff formatting",
  "When showing code changes to the user, ALWAYS use ```diff fenced code blocks (not ```bash or other languages).",
  "Format as unified diff with @@ -line,count +line,count @@ hunk headers.",
  "Include at least 3 lines of context (space-prefixed) before and after each change hunk.",
  "This renders as a side-by-side diff view for the user.",
  "",
  "# Drive the task to completion",
  "Once you have understood the request, keep working until the task is finished or you hit a real blocker. Do not stop after listing what you will do next — listing steps is not progress; only tool calls that change the workspace are.",
  "Do not ask the user whether to continue, whether to proceed to the next step, or whether they want you to do the thing they already asked for. Phrases like \"if you want, I can also...\", \"shall I continue?\", \"want me to do X next?\" are forbidden when X is already implied by the original request. Just do it.",
  "If you finished one part of a multi-part request, immediately start the next part in the same turn. Do not yield the turn back to the user between sub-tasks.",
  "Only stop and ask the user when you are genuinely blocked: missing information you cannot infer, an ambiguous choice with no safe default, or an action with large irreversible blast radius (force-push, deleting their work, sending external messages).",
  "Do not overwrite or revert unrelated user changes. Check the working tree before broad edits, and keep modifications limited to files required by the task.",
  "If the user has to say \"keep going\", \"please continue\", \"are you done?\", or \"just do it\", you have already failed this rule — recalibrate and do not stop mid-task again in this session.",
  "",
  "# Reporting when done",
  "When the task is actually finished, end the turn with a short, concrete report — not a proposal for more work. Include:",
  "  - Files changed (modified / added / deleted)",
  "  - Verification commands run and their result (pass / fail / not run and why)",
  "  - Anything the user must do themselves (e.g. restart a server, set an env var) — only if real",
  "Do not pad the report with offers to do additional work the user did not ask for.",
].join("\n")

const LITE_SYSTEM_PROMPT = [
  "You are the local worker for a coding task.",
  "",
  "# Loop",
  "1. Inspect: gather evidence before changing code.",
  "2. Change: make the smallest relevant change.",
  "3. Check: run focused verification and read failures.",
  "4. Finish: return a concise normal final response with evidence.",
  "",
  "# Rules",
  "- Use only the provided tools.",
  "- Do not repeat an identical failed action; inspect the failure and try a different approach.",
  "- Treat teacher messages as guidance, not verified facts or permission.",
  "- After teacher advice, inspect the suggested evidence before editing.",
  "- Request teacher help only when genuinely blocked; do not request routine review.",
  "- Do the requested work directly unless the user explicitly asks only for analysis, explanation, brainstorming, or a plan.",
  "- After non-trivial changes, run the most relevant focused verification available.",
].join("\n")

const LITE_PLAN_MODE_REMINDER = [
  "You are currently in Plan mode.",
  "Inspect with the provided read-only tools and return a concise plan.",
  "Do not modify files or run commands that change the workspace.",
].join("\n")

const BUILD_MODE_REMINDER = [
  "You are currently in Build mode.",
  "You are permitted to read files, edit files, and run commands.",
  "Apply the completion and reporting rules above to every request in this session: announce briefly (one sentence), then execute in the same turn instead of stopping at a proposal.",
].join("\n")

const PLAN_MODE_REMINDER = [
  "You are currently in Plan mode.",
  "You may inspect the project with read-only tools such as reading files, searching files, listing matching files, fetching referenced documentation, and analyzing images.",
  "Do not write code, edit files, apply patches, run shell commands, commit changes, or perform browser/app actions.",
  "Use inspection results to explain the current state, approach, risks, and step-by-step plan.",
].join("\n")

const VISION_SECTION = [
  "# Vision",
  "",
  "If your model supports vision (GPT-4o, Claude, etc.), browser screenshots and image files are sent directly to you as images.",
  "You can see and analyze them in detail without any intermediate step.",
  "",
  "Use the `analyze_image` tool when you need to analyze an arbitrary image file (PNG, JPEG, etc.).",
  "When the current chat model supports vision natively, `analyze_image` attaches the image for direct provider vision analysis and does not call a local VLM first.",
  "If your model does not support vision, images are automatically analyzed by a local VLM and you receive a textual description instead.",
  "Configure the local VLM via OPENZEROCODE_VLM_URL and OPENZEROCODE_VLM_MODEL env vars.",
].join("\n")

const COMPOSE_MODE_REMINDER = [
  "You are currently in Compose mode.",
  "Compose mode provides a structured workflow for specs-driven development.",
  "When the human supplies an ordered, sufficiently detailed TODO list or implementation plan, treat it as implementation authorization: execute the tasks in order without asking for routine confirmation, progress updates, per-task reviews, or a new recommendation between tasks.",
  "Keep the approved task list as the scope boundary. Complete each task end-to-end with focused tests and verification, update its status, then immediately proceed to the next incomplete task. Only stop for a genuine blocker, ambiguity that cannot be safely inferred, or a required high-impact decision.",
  "Batch completion activities: do not perform broad code review, repository review, formatting-only work, commits, reports, or retrospective analysis after every small task. Once all approved implementation tasks are complete, run integrated verification and one focused final review.",
  "You have access to the following compose skills. Invoke the appropriate skill based on the current stage of development:",
  "",
  "## Available Compose Skills",
  "",
  "- **compose:brainstorm** — Explore user intent, requirements, and design before implementation. Use BEFORE any creative work.",
  "- **compose:plan** — Write detailed implementation plans from specs. Use when you have requirements for a multi-step task.",
  "- **compose:tdd** — Test-driven development discipline. Use when implementing any feature or bugfix.",
  "- **compose:execute** — Execute a written implementation plan step-by-step.",
  "- **compose:verify** — Evidence-based verification before claiming work is complete.",
  "- **compose:review** — Code review via subagent dispatch.",
  "- **compose:merge** — Complete development work (merge/PR/discard).",
  "- **compose:debug** — Debugging guidance for bugs, test failures, or unexpected behavior.",
  "- **compose:learn** — Extract non-obvious learnings from sessions into structured knowledge artifacts.",
  "- **compose:ask** — Route decisions through the question tool. Use whenever you need user input.",
  "- **compose:parallel** — Dispatch parallel agents for independent tasks.",
  "- **compose:feedback** — Handle code review feedback with technical rigor.",
  "- **compose:report** — Write final reports after implementation is verified.",
  "- **compose:subagent** — Execute plans with fresh subagent per task and two-stage review.",
  "- **compose:worktree** — Set up isolated workspaces via git worktrees.",
  "",
  "## Workflow",
  "",
  "The typical compose lifecycle is:",
  "1. **Brainstorm** — Understand the idea, explore approaches, present design",
  "2. **Plan** — Write detailed implementation plan with TDD steps",
  "3. **Implement** — Execute plan using TDD (compose:tdd + compose:execute)",
  "4. **Verify** — Run verification commands, confirm output",
  "5. **Review** — Code review",
  "6. **Merge** — Complete development",
  "",
  "## How to Use Skills",
  "",
  "When the user describes a task, determine which skill applies and follow its guidance.",
  "Skills are loaded from the project's skills/compose/ directory.",
  "Each skill has its own workflow — follow it step by step.",
  "",
  "## Learnings",
  "",
  "Before brainstorming, load project learnings from docs/compose/learnings/*.md as context.",
  "After verify/debug failures, trigger compose:learn to extract the discovery.",
].join("\n")

function buildEnvironmentSection(cwd: string): string {
  const isGit = existsSync(resolve(cwd, ".git"))
  return [
    "# Environment",
    `- Working directory: ${cwd}`,
    `- Platform: ${process.platform}`,
    `- Today's date: ${new Date().toISOString().slice(0, 10)}`,
    `- Git repository: ${isGit ? "yes" : "no"}`,
  ].join("\n")
}

function buildGeassSection(): string | null {
  if (!isConnected()) return null
  return [
    "# GEASS Browser (connected)",
    "",
    "GEASS Desktop is running and connected. You can control the browser with these tools:",
    "- `browser_navigate` — Navigate to a URL",
    "- `browser_read` — Read the current page content (headings, buttons, links, inputs, text)",
    "- `browser_click` — Click an element on the page",
    "- `browser_type` — Type text into an input field",
    "- `browser_select` — Select an option from a dropdown",
    "- `browser_scroll` — Scroll the page",
    "- `browser_screenshot` — Take a screenshot",
    "",
    "Use these tools when the user asks you to open a website, interact with a web page, or retrieve content that requires JavaScript rendering. Prefer `browser_navigate` + `browser_read` over `web_fetch` for modern web apps and pages that need JS execution.",
  ].join("\n")
}

interface ComposeSkill {
  name: string
  description?: string
  source: string
}

function loadComposeSkills(cwd: string): ComposeSkill[] {
  const dirs = [
    resolve(cwd, "skills", "compose"),
    join(homedir(), ".openzerocode", "skills", "compose"),
  ]

  const seen = new Set<string>()
  const skills: ComposeSkill[] = []

  for (const skillsDir of dirs) {
    if (!existsSync(skillsDir)) continue
    let entries: string[]
    try {
      entries = readdirSync(skillsDir)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (seen.has(entry)) continue
      const skillPath = join(skillsDir, entry, "SKILL.md")
      if (!existsSync(skillPath)) continue
      try {
        const raw = readFileSync(skillPath, "utf8")
        const { frontmatter } = splitFrontmatter(raw)
        const frontmatterName = typeof frontmatter.name === "string" ? frontmatter.name : undefined
        const description = typeof frontmatter.description === "string" ? frontmatter.description : undefined
        const name = frontmatterName ?? `compose:${entry}`
        seen.add(entry)
        skills.push({ name, description, source: skillPath })
      } catch {
        continue
      }
    }
  }
  return skills
}

function splitFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---")) return { frontmatter: {}, body: raw }
  const end = raw.indexOf("\n---", 3)
  if (end < 0) return { frontmatter: {}, body: raw }
  const yamlText = raw.slice(3, end).replace(/^\n/, "")
  const body = raw.slice(end + 4).replace(/^\n/, "")
  let frontmatter: Record<string, unknown> = {}
  try {
    frontmatter = (parseYaml(yamlText) as Record<string, unknown>) ?? {}
  } catch {
    frontmatter = {}
  }
  return { frontmatter, body }
}

function buildComposeSkillsSection(cwd: string): string {
  const skills = loadComposeSkills(cwd)
  if (skills.length === 0) return ""

  const parts = [
    "# Compose Skills (available from project + ~/.openzerocode/skills)",
    "",
    "The following compose skills are available. Do not inline all skill bodies into context. When a skill is relevant, read its SKILL.md file first, then follow it.",
    "",
  ]
  for (const skill of skills) {
    const line = skill.description
      ? `- **${skill.name}** — ${skill.description} (${skill.source})`
      : `- **${skill.name}** (${skill.source})`
    parts.push(line)
  }
  return parts.join("\n")
}

function buildLearningsSection(cwd: string): string {
  const learningsDir = resolve(cwd, "docs", "compose", "learnings")
  if (!existsSync(learningsDir)) return ""

  let entries: string[]
  try {
    entries = readdirSync(learningsDir)
  } catch {
    return ""
  }

  const mdFiles = entries.filter((e) => e.endsWith(".md"))
  if (mdFiles.length === 0) return ""

  const parts = ["# Project Learnings (auto-loaded)", ""]
  for (const file of mdFiles) {
    try {
      const content = readFileSync(join(learningsDir, file), "utf8")
      parts.push(content.trim())
      parts.push("")
    } catch {
      continue
    }
  }
  return parts.join("\n")
}

export function buildSystemPrompt(
  mode: RunMode,
  agentsInstruction?: string,
  contextInstruction?: string,
  cwd: string = process.cwd(),
  harnessProfile: HarnessProfile = getHarnessProfile(),
) {
  if (harnessProfile === "lite") {
    return buildLiteSystemPrompt(mode, agentsInstruction, contextInstruction, cwd)
  }

  const modeReminder = mode === "plan" ? PLAN_MODE_REMINDER : mode === "compose" ? COMPOSE_MODE_REMINDER : BUILD_MODE_REMINDER
  const parts = [BASE_SYSTEM_PROMPT, modeReminder]

  parts.push(buildEnvironmentSection(cwd))

  // Plan mode exposes only narrow read-only inspection tools, and Compose mode
  // loads compose skills. General tool-specific guidance belongs in Build mode.
  if (mode === "build") {
    parts.push(TODO_INSTRUCTIONS)

    const geassSection = buildGeassSection()
    if (geassSection) {
      parts.push(geassSection)
    }

    parts.push(VISION_SECTION)
  }

  if (mode === "compose") {
    const composeSkillsSection = buildComposeSkillsSection(cwd)
    if (composeSkillsSection) {
      parts.push(composeSkillsSection)
    }

    const learningsSection = buildLearningsSection(cwd)
    if (learningsSection) {
      parts.push(learningsSection)
    }
  }

  if (agentsInstruction) {
    parts.push("# Workspace Instructions from AGENTS.md\n\n" + agentsInstruction)
  }

  if (contextInstruction) {
    parts.push("# Workspace Context from CONTEXT.md\n\n" + contextInstruction)
  }

  return parts.join("\n\n")
}

export function buildLiteSystemPrompt(
  mode: RunMode,
  agentsInstruction: string | undefined,
  contextInstruction: string | undefined,
  cwd: string,
): string {
  if (mode === "compose") {
    throw new Error("Lite harness does not support Compose mode. Switch to the productive harness.")
  }

  const parts = [LITE_SYSTEM_PROMPT, mode === "plan" ? LITE_PLAN_MODE_REMINDER : "You are currently in Build mode.", buildEnvironmentSection(cwd)]

  // AGENTS remains useful operational context, but bounded so local models do
  // not lose the prompt-size benefit of the Lite profile. CONTEXT is omitted:
  // it is optional background rather than loop-critical instruction.
  if (agentsInstruction?.trim()) {
    parts.push(
      "# Workspace Instructions (truncated for Lite mode)\n\n" +
      agentsInstruction.trim().slice(0, LITE_WORKSPACE_INSTRUCTIONS_MAX_CHARS),
    )
  }

  return parts.join("\n\n")
}
