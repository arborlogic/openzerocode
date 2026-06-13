import { spawn, execFile } from "node:child_process"
import { platform } from "os"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

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

export async function copyToClipboard(text: string) {
  if (!text) return
  if (process.stdout.isTTY) {
    const base64 = Buffer.from(text).toString("base64")
    process.stdout.write(`\x1b]52;c;${base64}\x07`)
  }

  const p = platform()
  const cmd = p === "darwin" ? "pbcopy" : p === "win32" ? "clip" : "xclip"
  const args = p === "linux" ? ["-selection", "clipboard"] : []
  await new Promise<void>((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] })
    child.on("error", () => resolve())
    child.on("close", () => resolve())
    child.stdin?.write(text)
    child.stdin?.end()
  })
}

export async function readClipboard(): Promise<string> {
  const p = platform()
  const cmd = p === "darwin" ? "pbpaste" : p === "win32" ? "powershell.exe" : "xclip"
  const args = p === "win32" ? ["-NoProfile", "-Command", "Get-Clipboard"] : p === "linux" ? ["-selection", "clipboard", "-o"] : []
  return await new Promise<string>((resolve) => {
    const child = spawn(cmd, args)
    let out = ""
    child.stdout.on("data", (d) => (out += d.toString()))
    child.on("error", () => resolve(""))
    child.on("close", (code) => (code === 0 ? resolve(out) : resolve("")))
  })
}

export function openExternalUrl(url: string) {
  const p = platform()
  if (p === "darwin") spawn("open", [url], { stdio: "ignore", detached: true }).unref()
  else if (p === "win32") spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true }).unref()
  else spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref()
}
