import { spawn, execFile } from "node:child_process"
import { platform } from "os"
import { promisify } from "node:util"
import { existsSync } from "node:fs"
import path from "node:path"

const execFileAsync = promisify(execFile)

export interface ClipboardCommand {
  command: string
  args: string[]
}

export interface ClipboardCommandCandidates {
  copy: ClipboardCommand[]
  paste: ClipboardCommand[]
}

/** Return native clipboard commands in the order appropriate for the desktop session. */
export function getClipboardCommandCandidates(
  p = platform(),
  env: NodeJS.ProcessEnv = process.env,
): ClipboardCommandCandidates {
  if (p === "darwin") {
    return {
      copy: [{ command: "pbcopy", args: [] }],
      paste: [{ command: "pbpaste", args: [] }],
    }
  }
  if (p === "win32") {
    return {
      copy: [{ command: "clip", args: [] }],
      paste: [{ command: "powershell.exe", args: ["-NoProfile", "-Command", "Get-Clipboard"] }],
    }
  }
  if (p !== "linux") return { copy: [], paste: [] }

  const wayland = Boolean(env.WAYLAND_DISPLAY) || env.XDG_SESSION_TYPE?.toLowerCase() === "wayland"
  const waylandCommands: ClipboardCommandCandidates = {
    copy: [{ command: "wl-copy", args: [] }],
    paste: [{ command: "wl-paste", args: ["--no-newline"] }],
  }
  const x11Commands: ClipboardCommandCandidates = {
    copy: [
      { command: "xclip", args: ["-selection", "clipboard"] },
      { command: "xsel", args: ["--clipboard", "--input"] },
    ],
    paste: [
      { command: "xclip", args: ["-selection", "clipboard", "-o"] },
      { command: "xsel", args: ["--clipboard", "--output"] },
    ],
  }

  const copy = wayland
    ? [...waylandCommands.copy, ...x11Commands.copy]
    : [...x11Commands.copy, ...waylandCommands.copy]
  const paste = wayland
    ? [...waylandCommands.paste, ...x11Commands.paste]
    : [...x11Commands.paste, ...waylandCommands.paste]

  // WSL can access the Windows clipboard even when no Linux display server is available.
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) {
    copy.push({ command: "clip.exe", args: [] })
    paste.push({ command: "powershell.exe", args: ["-NoProfile", "-Command", "Get-Clipboard"] })
  }
  return { copy, paste }
}

function writeWithCommand(candidate: ClipboardCommand, text: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(ok)
    }
    const child = spawn(candidate.command, candidate.args, { stdio: ["pipe", "ignore", "ignore"] })
    const timer = setTimeout(() => {
      child.kill()
      finish(false)
    }, 3000)
    timer.unref()
    child.on("error", () => finish(false))
    child.on("close", (code) => finish(code === 0))
    child.stdin?.on("error", () => finish(false))
    child.stdin?.end(text)
  })
}

function readWithCommand(candidate: ClipboardCommand): Promise<{ ok: boolean; text: string }> {
  return new Promise((resolve) => {
    let settled = false
    let out = ""
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ ok, text: ok ? out : "" })
    }
    const child = spawn(candidate.command, candidate.args, { stdio: ["ignore", "pipe", "ignore"] })
    const timer = setTimeout(() => {
      child.kill()
      finish(false)
    }, 3000)
    timer.unref()
    child.stdout?.on("data", (data) => (out += data.toString()))
    child.on("error", () => finish(false))
    child.on("close", (code) => finish(code === 0))
  })
}

function writeOsc52(text: string): boolean {
  if (!process.stdout.isTTY) return false
  const base64 = Buffer.from(text).toString("base64")
  process.stdout.write(`\x1b]52;c;${base64}\x07`)
  return true
}

/** Run git command and return trimmed stdout, or empty string on failure. */
export async function runGit(args: string[], timeout = 1000, maxBuffer = 1024 * 256): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      encoding: "utf-8",
      timeout,
      maxBuffer,
    })
    return stdout.trim()
  } catch {
    return ""
  }
}

/** Check for modified/new/deleted tracked files in the working tree vs HEAD. */
export async function getGitFileChanges(): Promise<{ modified: string[]; added: string[]; deleted: string[] }> {
  const out = await runGit(["diff", "--name-status", "HEAD"], 2000, 1024 * 1024)
  const modified: string[] = []
  const added: string[] = []
  const deleted: string[] = []
  for (const line of out.split(/\r?\n/).filter(Boolean)) {
    const status = line[0]
    const file = line.slice(1).trim()
    if (!file) continue
    if (status === "D") deleted.push(file)
    else if (status === "A") added.push(file)
    else if (status === "M") modified.push(file)
  }
  return { modified, added, deleted }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false
  for (const candidate of getClipboardCommandCandidates().copy) {
    if (await writeWithCommand(candidate, text)) return true
  }
  return writeOsc52(text)
}

export async function readClipboard(): Promise<string> {
  for (const candidate of getClipboardCommandCandidates().paste) {
    const result = await readWithCommand(candidate)
    if (result.ok) return result.text
  }
  return ""
}

export function openExternalUrl(url: string) {
  const p = platform()
  if (p === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref()
  else if (p === "win32") spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref()
  else spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref()
}

export function revealFileInFolder(filePath: string, cwd = process.cwd()): boolean {
  if (!filePath) return false

  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath)
  const targetPath = existsSync(absolutePath) ? absolutePath : path.dirname(absolutePath)
  if (!existsSync(targetPath)) return false

  const p = platform()
  if (p === "darwin") {
    spawn("open", existsSync(absolutePath) ? ["-R", absolutePath] : [targetPath], { stdio: "ignore", detached: true }).unref()
  } else if (p === "win32") {
    spawn("explorer.exe", existsSync(absolutePath) ? ["/select,", absolutePath] : [targetPath], {
      stdio: "ignore",
      detached: true,
    }).unref()
  } else {
    spawn("xdg-open", [targetPath], { stdio: "ignore", detached: true }).unref()
  }
  return true
}
