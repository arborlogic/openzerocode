import { readdirSync, readFileSync, existsSync, statSync } from "node:fs"
import { join, isAbsolute } from "node:path"
import { homedir } from "node:os"
import { parse as parseYaml } from "yaml"

export interface SkillMatch {
  domains?: string[]
  url_patterns?: string[]
}

export interface SkillFrontmatter {
  name?: string
  summary?: string
  description?: string
  match?: SkillMatch
}

export interface LoadedSkill {
  name: string
  dir: string
  skillPath: string
  frontmatter: SkillFrontmatter
  body: string
  learnings?: string
  /** How this skill was matched: url_patterns > domains > description. */
  matchedBy: "url_patterns" | "domains" | "description"
}

/**
 * Resolve the directory that holds skills/<name>/SKILL.md.
 * Order: GEASS_SKILLS_DIR env → <cwd>/skills → ~/Dev/ai-util/geass-agent/skills.
 */
export function resolveSkillsDir(cwd: string = process.cwd()): string | undefined {
  const candidates = [
    process.env.GEASS_SKILLS_DIR,
    join(cwd, "skills"),
    join(homedir(), "Dev", "ai-util", "geass-agent", "skills"),
  ].filter((c): c is string => Boolean(c))

  for (const c of candidates) {
    const abs = isAbsolute(c) ? c : join(cwd, c)
    if (existsSync(abs) && statSync(abs).isDirectory()) return abs
  }
  return undefined
}

function splitFrontmatter(raw: string): { frontmatter: SkillFrontmatter; body: string } {
  if (!raw.startsWith("---")) return { frontmatter: {}, body: raw }
  const end = raw.indexOf("\n---", 3)
  if (end < 0) return { frontmatter: {}, body: raw }
  const yamlText = raw.slice(3, end).replace(/^\n/, "")
  const body = raw.slice(end + 4).replace(/^\n/, "")
  let frontmatter: SkillFrontmatter = {}
  try {
    frontmatter = (parseYaml(yamlText) as SkillFrontmatter) ?? {}
  } catch {
    frontmatter = {}
  }
  return { frontmatter, body }
}

interface ParsedSkill {
  name: string
  dir: string
  skillPath: string
  frontmatter: SkillFrontmatter
  body: string
  learnings?: string
}

function parseAllSkills(skillsDir: string): ParsedSkill[] {
  const out: ParsedSkill[] = []
  let entries: string[]
  try {
    entries = readdirSync(skillsDir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const dir = join(skillsDir, entry)
    const skillPath = join(dir, "SKILL.md")
    if (!existsSync(skillPath)) continue
    let raw: string
    try {
      raw = readFileSync(skillPath, "utf8")
    } catch {
      continue
    }
    const { frontmatter, body } = splitFrontmatter(raw)
    const learningsPath = join(dir, "LEARNINGS.md")
    let learnings: string | undefined
    if (existsSync(learningsPath)) {
      try {
        learnings = readFileSync(learningsPath, "utf8")
      } catch {
        learnings = undefined
      }
    }
    out.push({ name: frontmatter.name ?? entry, dir, skillPath, frontmatter, body, learnings })
  }
  return out
}

/** Glob-ish matcher supporting `*` (any chars) for url_patterns. */
function urlPatternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")
  return new RegExp(`^${escaped}$`)
}

function hostnameOf(url: string): string | undefined {
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

function domainMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

/**
 * Match the current URL against all skills.
 * Resolution order per architecture doc: url_patterns → domains → description.
 * description matching is intentionally NOT fuzzy here — it's a no-op fallback
 * left to the LLM. We only return structured (url_patterns/domains) matches.
 */
export function matchSkillByUrl(url: string, skillsDir: string): LoadedSkill | undefined {
  const skills = parseAllSkills(skillsDir)
  const host = hostnameOf(url)

  // 1. url_patterns (most specific)
  for (const s of skills) {
    const patterns = s.frontmatter.match?.url_patterns ?? []
    if (patterns.some((p) => urlPatternToRegex(p).test(url))) {
      return { ...s, matchedBy: "url_patterns" }
    }
  }

  // 2. domains (hostname fallback)
  if (host) {
    for (const s of skills) {
      const domains = s.frontmatter.match?.domains ?? []
      if (domains.some((d) => domainMatches(host, d))) {
        return { ...s, matchedBy: "domains" }
      }
    }
  }

  return undefined
}

/** Build the prompt section injected for a matched skill (SKILL.md + LEARNINGS.md). */
export function buildSkillSection(skill: LoadedSkill): string {
  const parts: string[] = []
  parts.push(`# Active Skill: ${skill.name}`)
  parts.push(
    `The current page matched this skill (by ${skill.matchedBy}). Follow it as the authoritative golden path.`,
  )
  parts.push("")
  parts.push(skill.body.trim())
  if (skill.learnings && skill.learnings.trim()) {
    parts.push("")
    parts.push("---")
    parts.push("")
    parts.push("## Accumulated Learnings (auto-collected, treat as hints)")
    parts.push("")
    parts.push(skill.learnings.trim())
  }
  return parts.join("\n")
}
