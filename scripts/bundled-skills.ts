import { cp, rm } from "node:fs/promises"

/**
 * Replace the skills shipped with a binary as one managed tree. Keeping this
 * separate from a sibling `skills/` directory lets users keep local skills
 * while ensuring deleted bundled skills cannot survive a build or upgrade.
 */
export async function replaceBundledSkills(source: string, destination: string): Promise<void> {
  await rm(destination, { recursive: true, force: true })
  await cp(source, destination, { recursive: true })
}
