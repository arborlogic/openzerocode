import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type ExperimentKey = "lightweightRecovery"

export type Experiments = Record<ExperimentKey, boolean>

const DEFAULTS: Experiments = {
  lightweightRecovery: false,
}

function getConfigDir() {
  return join(homedir(), ".openzerocode")
}

function getExperimentsPath() {
  return join(getConfigDir(), "experiments.json")
}

function ensureDir() {
  const dir = getConfigDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function loadExperiments(): Experiments {
  try {
    const raw = readFileSync(getExperimentsPath(), "utf-8")
    const parsed = JSON.parse(raw) as Partial<Experiments>
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveExperiments(patch: Partial<Experiments>) {
  try {
    ensureDir()
    const next = { ...loadExperiments(), ...patch }
    const path = getExperimentsPath()
    const tmp = `${path}.tmp`
    writeFileSync(tmp, JSON.stringify(next, null, 2), "utf-8")
    renameSync(tmp, path)
  } catch {
    // Experiments are non-critical; keep the app usable if persistence fails.
  }
}

export function isExperimentEnabled(key: ExperimentKey): boolean {
  return loadExperiments()[key] === true
}

export function setExperimentEnabled(key: ExperimentKey, enabled: boolean): Experiments {
  saveExperiments({ [key]: enabled } as Partial<Experiments>)
  return loadExperiments()
}
