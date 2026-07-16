import { readdirSync, readFileSync, existsSync, statSync } from "node:fs"
import { join, isAbsolute, relative, resolve } from "node:path"
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

/** A skill available for discovery, without its instruction body. */
export interface SkillSummary {
  name: string
  description?: string
  skillPath: string
  /** True when the skill is shipped in OpenZeroCode's bundled skills directory. */
  isBuiltin: boolean
}

/**
 * Skills bundled beside the executable. The source-tree path keeps `bun run`
 * working; release builds replace the managed `bundled-skills/` tree on update.
 */
const BUILTIN_SKILLS_DIRS = [
  resolve(import.meta.dirname, "..", "..", "skills"),
  join(process.execPath, "..", "bundled-skills"),
]

function isBuiltinSkill(skill: ParsedSkill): boolean {
  return BUILTIN_SKILLS_DIRS.some((builtinDir) => {
    const pathFromBuiltinDir = relative(builtinDir, skill.dir)
    return pathFromBuiltinDir !== "" && !pathFromBuiltinDir.startsWith("..") && !isAbsolute(pathFromBuiltinDir)
  })
}

/**
 * Resolve ALL directories that hold skills/<name>/SKILL.md.
 * Search order: GEASS_SKILLS_DIR env → <cwd>/skills → ~/.openzerocode/skills → ~/Dev/ai-util/geass-agent/skills → bundled skills
 * Returns only directories that actually exist.
 */
export function resolveSkillDirs(cwd: string = process.cwd()): string[] {
  const candidates = [
    process.env.GEASS_SKILLS_DIR,
    join(cwd, "skills"),
    join(homedir(), ".openzerocode", "skills"),
    join(homedir(), "Dev", "ai-util", "geass-agent", "skills"),
    ...BUILTIN_SKILLS_DIRS,
  ].filter((c): c is string => Boolean(c))

  const dirs: string[] = []
  for (const c of candidates) {
    const abs = isAbsolute(c) ? c : join(cwd, c)
    if (existsSync(abs) && statSync(abs).isDirectory() && !dirs.includes(abs)) dirs.push(abs)
  }
  return dirs
}

/**
 * Resolve the first directory that holds skills/<name>/SKILL.md.
 * Prefer project-level skills over user-level skills.
 */
export function resolveSkillsDir(cwd: string = process.cwd()): string | undefined {
  const dirs = resolveSkillDirs(cwd)
  return dirs[0]
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
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    const skillPath = join(dir, "SKILL.md")
    if (!existsSync(skillPath)) {
      out.push(...parseAllSkills(dir))
      continue
    }
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

/**
 * List every discoverable skill in the supplied directories.
 * Directories are considered in order, so a project or configured skill with
 * the same name overrides a later user-global one.
 */
export function listSkills(skillsDirs: string[]): SkillSummary[] {
  const skills = skillsDirs.flatMap((dir) => parseAllSkills(dir))
  const seen = new Set<string>()
  return skills
    .filter((skill) => {
      if (seen.has(skill.name)) return false
      seen.add(skill.name)
      return true
    })
    .map((skill) => ({
      name: skill.name,
      description: skill.frontmatter.description ?? skill.frontmatter.summary,
      skillPath: skill.skillPath,
      isBuiltin: isBuiltinSkill(skill),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Find a skill by its metadata name or its directory-relative path. */
export function findSkill(name: string, skillsDirs: string[]): ParsedSkill | undefined {
  const normalized = name.trim().toLowerCase()
  for (const skillsDir of skillsDirs) {
    const match = parseAllSkills(skillsDir).find((skill) =>
      skill.name.toLowerCase() === normalized || relative(skillsDir, skill.dir).toLowerCase() === normalized,
    )
    if (match) return match
  }
  return undefined
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
 *
 * skillsDir can be a single directory string or an array of directories.
 * When an array is given, all directories are searched in order; the first match wins.
 */
export function matchSkillByUrl(url: string, skillsDir: string | string[]): LoadedSkill | undefined {
  const dirs = Array.isArray(skillsDir) ? skillsDir : [skillsDir]
  const skills = dirs.flatMap((d) => parseAllSkills(d))
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
  return buildSkillSectionForActivation(
    skill,
    `The current page matched this skill (by ${skill.matchedBy}). Follow it as the authoritative golden path.`,
  )
}

/** Build the prompt section when a user explicitly selects a skill. */
export function buildExplicitSkillSection(skill: Pick<LoadedSkill, "name" | "body" | "learnings">): string {
  return buildSkillSectionForActivation(
    skill,
    "The user explicitly selected this skill. Follow it as the authoritative instruction for this request.",
  )
}

function buildSkillSectionForActivation(skill: Pick<LoadedSkill, "name" | "body" | "learnings">, activation: string): string {
  const parts: string[] = []
  parts.push(`# Active Skill: ${skill.name}`)
  parts.push(activation)
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
