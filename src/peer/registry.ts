import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs"
import { realpathSync } from "fs"
import { randomBytes } from "crypto"
import { join, resolve } from "path"
import { homedir } from "os"

export type PeerEntry = {
  name: string
  port: number
  pid: number
  startTime: number
  workdir: string
  token: string
}

export type RegisterResult =
  | { ok: true; token: string }
  | { ok: false; error: string }

function getPeersFile(): string {
  return join(process.env.HOME ?? homedir(), ".openzerocode", "peers.json")
}

function ensureDir() {
  const dir = join(process.env.HOME ?? homedir(), ".openzerocode")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function readPeers(): PeerEntry[] {
  try {
    const file = getPeersFile()
    if (!existsSync(file)) return []
    return JSON.parse(readFileSync(file, "utf-8")) as PeerEntry[]
  } catch {
    return []
  }
}

function writePeers(peers: PeerEntry[]) {
  ensureDir()
  const target = getPeersFile()
  const tmp = target + ".tmp"
  writeFileSync(tmp, JSON.stringify(peers, null, 2), "utf-8")
  renameSync(tmp, target)
}

export function canonicalWorkdir(p: string): string {
  try { return realpathSync(p) } catch { return resolve(p) }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function listLivePeers(): PeerEntry[] {
  return readPeers().filter(p => isProcessAlive(p.pid))
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url")
}

export function registerPeer(name: string, port: number, workdir: string, token: string): RegisterResult {
  const realWorkdir = canonicalWorkdir(workdir)
  const alive = readPeers().filter(p => isProcessAlive(p.pid))

  if (alive.some(p => p.name === name)) {
    return { ok: false, error: `A peer named "${name}" is already running` }
  }

  if (alive.some(p => canonicalWorkdir(p.workdir) === realWorkdir)) {
    return { ok: false, error: `A peer is already running for this directory` }
  }

  alive.push({ name, port, pid: process.pid, startTime: Date.now(), workdir: realWorkdir, token })
  writePeers(alive)

  return { ok: true, token }
}

export function unregisterPeer(name: string) {
  writePeers(readPeers().filter(p => !(p.name === name && p.pid === process.pid)))
}

export function findPeer(name: string): PeerEntry | undefined {
  return listLivePeers().find(p => p.name === name)
}
