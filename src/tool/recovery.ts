import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { basename, dirname, join, relative, resolve } from "node:path"
import { isExperimentEnabled } from "../client/experiments"

export type RecoveryOperation = "write" | "edit"

export type RecoveryFileCheckpoint = {
  filePath: string
  target: string
  operation: RecoveryOperation
  /** Whether the target existed before the write/edit operation began. */
  existed: boolean
  /** Restorable post-change snapshot path. */
  contentPath?: string
  /** Pre-change snapshot path, when there was content to preserve. */
  beforeContentPath?: string
  /** Whether the target exists in the restorable checkpoint state. */
  existsAfter?: boolean
}

export type RecoveryCheckpoint = {
  id: string
  timestamp: string
  cwd: string
  /** Multi-file checkpoints created by grouped tool calls. */
  files?: RecoveryFileCheckpoint[]
  /** Legacy single-file fields. */
  filePath: string
  target: string
  operation: RecoveryOperation
  /** Whether the target existed before the write/edit operation began. */
  existed: boolean
  /** Legacy/restorable content path. New checkpoints set this to the post-change snapshot. */
  contentPath?: string
  /** Pre-change snapshot path, when there was content to preserve. */
  beforeContentPath?: string
  /** Whether the target exists in the restorable checkpoint state. */
  existsAfter?: boolean
}

const MAX_CHECKPOINTS = 100

function recoveryRoot(cwd: string) {
  return join(cwd, ".openzerocode", "recovery")
}

function safeHash(input: string) {
  return createHash("sha256").update(input).digest("hex").slice(0, 16)
}

function timestampIdPart(date = new Date()) {
  return date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 17)
}

function checkpointDir(cwd: string, id: string) {
  return join(recoveryRoot(cwd), id)
}

function manifestPath(cwd: string, id: string) {
  return join(checkpointDir(cwd, id), "manifest.json")
}

function normalizeDisplayPath(cwd: string, filePath: string, target: string) {
  if (filePath.startsWith("/")) return filePath
  const rel = relative(cwd, target)
  return rel && !rel.startsWith("..") ? rel : filePath
}

async function makeCheckpointId(cwd: string, input: { operation: RecoveryOperation; target: string; groupId?: string }) {
  if (input.groupId) {
    const hash = safeHash(`group:${input.groupId}`)
    try {
      const entries = await readdir(recoveryRoot(cwd), { withFileTypes: true })
      const existing = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(`-${hash}`))
      if (existing) return existing.name
    } catch {
      // No recovery directory yet.
    }
    return `${timestampIdPart()}-${hash}`
  }
  return `${timestampIdPart()}-${safeHash(`${input.operation}:${input.target}:${Math.random()}`)}`
}

function fileStem(index: number) {
  return `files/${index}`
}

function checkpointFiles(checkpoint: RecoveryCheckpoint): RecoveryFileCheckpoint[] {
  return checkpoint.files?.length ? checkpoint.files : [{
    filePath: checkpoint.filePath,
    target: checkpoint.target,
    operation: checkpoint.operation,
    existed: checkpoint.existed,
    contentPath: checkpoint.contentPath,
    beforeContentPath: checkpoint.beforeContentPath,
    existsAfter: checkpoint.existsAfter,
  }]
}

function summarizeFiles(files: RecoveryFileCheckpoint[]) {
  if (files.length === 0) return "no files"
  if (files.length === 1) return files[0]!.filePath || basename(files[0]!.target)
  const shown = files.slice(0, 3).map((file) => file.filePath || basename(file.target)).join(", ")
  return files.length > 3 ? `${shown}, +${files.length - 3} more` : shown
}

async function trimOldCheckpoints(cwd: string) {
  const checkpoints = await listRecoveryCheckpoints(cwd)
  const old = checkpoints.slice(MAX_CHECKPOINTS)
  await Promise.all(old.map((checkpoint) => rm(checkpointDir(cwd, checkpoint.id), { recursive: true, force: true })))
}

async function writeManifest(checkpoint: RecoveryCheckpoint) {
  await mkdir(checkpointDir(checkpoint.cwd, checkpoint.id), { recursive: true })
  await writeFile(manifestPath(checkpoint.cwd, checkpoint.id), JSON.stringify(checkpoint, null, 2), "utf-8")
}

export function isRecoveryEnabled() {
  return isExperimentEnabled("lightweightRecovery")
}

export async function createRecoveryCheckpoint(input: {
  cwd: string
  filePath: string
  target: string
  operation: RecoveryOperation
  groupId?: string
}): Promise<RecoveryCheckpoint | undefined> {
  if (!isRecoveryEnabled()) return undefined

  const target = resolve(input.target)
  const id = await makeCheckpointId(input.cwd, { operation: input.operation, target, groupId: input.groupId })
  const dir = checkpointDir(input.cwd, id)
  await mkdir(join(dir, "files"), { recursive: true })

  let checkpoint: RecoveryCheckpoint | undefined
  try {
    const raw = await readFile(manifestPath(input.cwd, id), "utf-8")
    checkpoint = JSON.parse(raw) as RecoveryCheckpoint
  } catch {
    // First file in this checkpoint group.
  }

  const files = checkpointFiles(checkpoint ?? {
    id,
    timestamp: new Date().toISOString(),
    cwd: input.cwd,
    filePath: "",
    target: "",
    operation: input.operation,
    existed: false,
    files: [],
  }).filter((file) => file.target)

  const existingIndex = files.findIndex((file) => file.target === target)
  const existed = existingIndex >= 0 ? files[existingIndex]!.existed : existsSync(target)
  const index = existingIndex >= 0 ? existingIndex : files.length
  const legacySingleFile = !input.groupId
  const stem = legacySingleFile ? "" : fileStem(index)
  const beforeContentPath = legacySingleFile ? "before" : `${stem}.before`
  const fileCheckpoint: RecoveryFileCheckpoint = existingIndex >= 0 ? files[existingIndex]! : {
    filePath: normalizeDisplayPath(input.cwd, input.filePath, target),
    target,
    operation: input.operation,
    existed,
    beforeContentPath: existed ? beforeContentPath : undefined,
  }

  if (existingIndex === -1 && existed) {
    const before = await readFile(target)
    await writeFile(join(dir, beforeContentPath), before)
  }

  if (existingIndex === -1) files.push(fileCheckpoint)

  const first = files[0] ?? fileCheckpoint
  checkpoint = {
    id,
    timestamp: checkpoint?.timestamp ?? new Date().toISOString(),
    cwd: input.cwd,
    files,
    // Keep top-level fields for older UI/tests and for single-file compatibility.
    filePath: files.length === 1 ? first.filePath : `${files.length} files`,
    target: first.target,
    operation: first.operation,
    existed: first.existed,
    contentPath: files.length === 1 ? first.contentPath : undefined,
    beforeContentPath: files.length === 1 ? first.beforeContentPath : undefined,
    existsAfter: files.length === 1 ? first.existsAfter : undefined,
  }

  await writeManifest(checkpoint)
  await trimOldCheckpoints(input.cwd)
  return checkpoint
}

export async function finalizeRecoveryCheckpoint(checkpoint: RecoveryCheckpoint | undefined, target?: string): Promise<RecoveryCheckpoint | undefined> {
  if (!checkpoint) return undefined

  const files = checkpointFiles(checkpoint)
  const selected = target ? files.filter((file) => file.target === resolve(target)) : files
  const dir = checkpointDir(checkpoint.cwd, checkpoint.id)
  await mkdir(join(dir, "files"), { recursive: true })

  for (const file of selected) {
    const index = files.findIndex((candidate) => candidate.target === file.target)
    const stem = checkpoint.files?.length ? fileStem(index >= 0 ? index : 0) : ""
    const afterContentPath = checkpoint.files?.length ? `${stem}.after` : "after"
    const existsAfter = existsSync(file.target)
    file.existsAfter = existsAfter
    file.contentPath = existsAfter ? (file.contentPath ?? afterContentPath) : undefined

    if (existsAfter) {
      const after = await readFile(file.target)
      await writeFile(join(dir, file.contentPath!), after)
    }
  }

  const first = files[0]
  checkpoint.files = checkpoint.files?.length ? files : checkpoint.files
  if (first) {
    checkpoint.filePath = files.length === 1 ? first.filePath : `${files.length} files`
    checkpoint.target = first.target
    checkpoint.operation = first.operation
    checkpoint.existed = first.existed
    checkpoint.contentPath = files.length === 1 ? first.contentPath : undefined
    checkpoint.beforeContentPath = files.length === 1 ? first.beforeContentPath : undefined
    checkpoint.existsAfter = files.length === 1 ? first.existsAfter : undefined
  }
  await writeManifest(checkpoint)
  return checkpoint
}

export async function listRecoveryCheckpoints(cwd: string): Promise<RecoveryCheckpoint[]> {
  try {
    const entries = await readdir(recoveryRoot(cwd), { withFileTypes: true })
    const checkpoints: RecoveryCheckpoint[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      try {
        const raw = await readFile(manifestPath(cwd, entry.name), "utf-8")
        const parsed = JSON.parse(raw) as RecoveryCheckpoint
        checkpoints.push(parsed)
      } catch {
        // Ignore partial/corrupt checkpoints.
      }
    }
    return checkpoints.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  } catch {
    return []
  }
}

export async function restoreRecoveryCheckpoint(cwd: string, id: string): Promise<{ ok: boolean; message: string }> {
  const checkpoints = await listRecoveryCheckpoints(cwd)
  const checkpoint = checkpoints.find((item) => item.id === id || item.id.startsWith(id))
  if (!checkpoint) return { ok: false, message: `Recovery checkpoint not found: ${id}` }

  const files = checkpointFiles(checkpoint)
  const dir = checkpointDir(cwd, checkpoint.id)
  for (const file of files) {
    if (file.contentPath) {
      const content = await readFile(join(dir, file.contentPath))
      await mkdir(dirname(file.target), { recursive: true })
      await writeFile(file.target, content)
      continue
    }

    // Backward compatibility for older checkpoints that only captured pre-change state.
    if (!file.existed) {
      await rm(file.target, { force: true })
      continue
    }

    const beforePath = file.beforeContentPath ?? "before"
    const before = await readFile(join(dir, beforePath))
    await mkdir(dirname(file.target), { recursive: true })
    await writeFile(file.target, before)
  }

  if (checkpoint.files?.length) {
    return { ok: true, message: `Restored ${files.length} file(s) to checkpoint ${checkpoint.id}: ${summarizeFiles(files)}` }
  }
  const file = files[0]!
  if (file.contentPath) return { ok: true, message: `Restored ${file.filePath} to checkpoint ${checkpoint.id}` }
  if (!file.existed) return { ok: true, message: `Removed ${file.filePath} (restored legacy pre-create state)` }
  return { ok: true, message: `Restored ${file.filePath} from legacy pre-change checkpoint ${checkpoint.id}` }
}

export function formatRecoveryCheckpoint(checkpoint: RecoveryCheckpoint) {
  const time = checkpoint.timestamp.replace("T", " ").slice(0, 19)
  const files = checkpointFiles(checkpoint)
  const hasAfter = files.some((file) => file.contentPath)
  const allLegacyPreCreate = files.every((file) => !file.contentPath && !file.existed)
  const action = hasAfter ? "checkpoint" : allLegacyPreCreate ? "legacy-pre-create" : "legacy-backup"
  const operation = files.length === 1 ? files[0]!.operation : "batch"
  return `${checkpoint.id}  ${time}  ${operation}  ${action}  ${summarizeFiles(files)}`
}
