import { listSkills } from "./skill-loader"

/** Per-session settings for model-directed skill discovery. */
export type SkillActivation = {
  mode: "off" | "auto"
}

export const NO_SKILLS: SkillActivation = { mode: "off" }

export function normalizeSkillActivation(value: unknown): SkillActivation {
  if (!value || typeof value !== "object") return NO_SKILLS
  const candidate = value as { mode?: unknown; names?: unknown }
  return candidate.mode === "auto" ? { mode: "auto" } : NO_SKILLS
}

/**
 * Build the skill addition to the system prompt.
 *
 * Auto mode intentionally only provides a compact catalog: the model decides
 * per turn which relevant SKILL.md files to read, so unrelated skill bodies do
 * not consume context.
 */
export function buildSkillRoutingSection(activation: SkillActivation, skillDirs: string[]): string | undefined {
  if (activation.mode !== "auto") return undefined
  const skills = listSkills(skillDirs)
  if (skills.length === 0) return undefined
  const catalog = skills
    .map((skill) => `- **${skill.name}**${skill.description ? ` — ${skill.description}` : ""}\n  Instructions: ${skill.skillPath}`)
    .join("\n")
  return [
    "# Automatic Skill Routing",
    "Automatic skill routing is enabled for this session. For each user request, decide from the catalog whether one or more skills are relevant. Before acting on a relevant skill, use the read tool to load its SKILL.md and follow it for that request. Do not read unrelated skills. This selection is per request; do not assume a previously used skill remains relevant.",
    "",
    "## Available Skills",
    catalog,
  ].join("\n")
}

export function formatSkillActivation(activation: SkillActivation): string {
  if (activation.mode === "auto") return "Automatic routing is enabled. The model selects relevant skills per request."
  return "No skills are active."
}
