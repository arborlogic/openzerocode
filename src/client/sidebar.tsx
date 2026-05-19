import { createSignal, createEffect, createMemo, For, Show } from "solid-js"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { Message } from "../provider/types"
import { getModelConfig, estimateCost } from "../provider/models"
import { isCompactSummaryMessage } from "./session-compact"
import { isSessionActive, getSessionActiveInfo } from "./sessions"
import type { TodoItem } from "../tool/todo"

type GitFile = {
  path: string
  additions: number
  deletions: number
  status: "modified" | "added"
}

type GitCommit = {
  hash: string
  subject: string
}

type GitSnapshot = {
  files: GitFile[]
  branch: string | null
  commits: GitCommit[]
}

const execFileAsync = promisify(execFile)
const EMPTY_GIT_SNAPSHOT: GitSnapshot = { files: [], branch: null, commits: [] }

let lastGitSnapshot = EMPTY_GIT_SNAPSHOT
let pendingGitSnapshot: Promise<GitSnapshot> | undefined

async function runGit(args: string[], timeout = 1000): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      encoding: "utf-8",
      timeout,
      maxBuffer: 1024 * 1024,
    })
    return stdout.trim()
  } catch {
    return ""
  }
}

function parseGitDiffNumstat(out: string): Omit<GitFile, "status">[] {
  if (!out) return []
  return out.split("\n").filter(Boolean).map((line) => {
    const parts = line.split("\t")
    const additions = Number.parseInt(parts[0] ?? "0", 10) || 0
    const deletions = Number.parseInt(parts[1] ?? "0", 10) || 0
    const filePath = parts.at(-1)?.trim() ?? ""
    return { path: filePath, additions, deletions }
  }).filter((file) => file.path.length > 0)
}

function parseRecentCommits(out: string): GitCommit[] {
  if (!out) return []
  return out.split("\n").filter(Boolean).map((line) => {
    const spaceIdx = line.indexOf(" ")
    const hash = spaceIdx >= 0 ? line.slice(0, spaceIdx) : line
    const subject = spaceIdx >= 0 ? line.slice(spaceIdx + 1) : ""
    return { hash, subject }
  })
}

async function readGitSnapshot(): Promise<GitSnapshot> {
  // Dedup concurrent calls: if a fetch is already in-flight, share its result.
  // The 300 ms debounce in the component effect already prevents rapid
  // successive reads, so we don't need an additional TTL cache here — without
  // it the sidebar stays in sync with the actual working tree state.
  if (pendingGitSnapshot) return pendingGitSnapshot

  pendingGitSnapshot = Promise.all([
    runGit(["diff", "--numstat", "HEAD"], 2000),
    runGit(["status", "--porcelain"], 2000),
    runGit(["rev-parse", "--abbrev-ref", "HEAD"], 1000),
    runGit(["log", "--oneline", "-3"], 1000),
  ]).then(([diff, porcelain, branch, commits]) => {
    // 1) Parse tracked changes from --numstat (modified + staged additions)
    const fileMap = new Map<string, GitFile>()
    for (const file of parseGitDiffNumstat(diff)) {
      fileMap.set(file.path, { ...file, status: "modified" })
    }

    // 2) Overlay status from --porcelain: mark staged additions as "added"
    for (const line of porcelain.split("\n").filter(Boolean)) {
      const statusRaw = line.slice(0, 2)
      const filePath = line.slice(3).trim()
      if (!filePath) continue

      // Staged addition (A in index column)
      if (statusRaw[0] === "A") {
        const existing = fileMap.get(filePath)
        if (existing) {
          existing.status = "added"
        } else {
          // Staged new file with no working-tree diff (empty file)
          fileMap.set(filePath, { path: filePath, additions: 0, deletions: 0, status: "added" })
        }
        continue
      }

      // Untracked file (??)
      if (statusRaw === "??") {
        // Only add if not already tracked by --numstat
        if (!fileMap.has(filePath)) {
          fileMap.set(filePath, { path: filePath, additions: 0, deletions: 0, status: "added" })
        }
      }
    }

    const snapshot: GitSnapshot = {
      files: [...fileMap.values()],
      branch: branch || null,
      commits: parseRecentCommits(commits),
    }
    lastGitSnapshot = snapshot
    return snapshot
  }).finally(() => {
    pendingGitSnapshot = undefined
  })
  return pendingGitSnapshot
}

function truncatePath(path: string, maxLen: number): string {
  if (path.length <= maxLen) return path
  return "…" + path.slice(-(maxLen - 1))
}

function fmtTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k"
  return String(n)
}

function fmtCost(n: number): string {
  if (n === 0) return "$0.00"
  if (n < 0.01) return "$<0.01"
  return "$" + n.toFixed(2)
}

export function Sidebar(props: {
  messages: () => Message[]
  todos?: () => TodoItem[]
  theme: {
    text: string
    muted: string
    surface: string
    border: string
    accent: string
  }
  width: number
  model: string
  provider: string
  sessionTitle?: string
  sessionId?: string
  cwd?: string
  /** Increment to force a git snapshot refresh from outside the component. */
  gitRefreshKey?: number
}) {
  const [gitFiles, setGitFiles] = createSignal<GitFile[]>([])
  const [branch, setBranch] = createSignal<string | null>(null)
  const [commits, setCommits] = createSignal<GitCommit[]>([])
  const [commitsCollapsed, setCommitsCollapsed] = createSignal(false)
  let gitRefreshSeq = 0

  // Poll session lock status every 3s while sidebar is visible
  const [lockTick, setLockTick] = createSignal(0)
  createEffect(() => {
    const id = setInterval(() => setLockTick(v => v + 1), 3000)
    return () => clearInterval(id)
  })

  createEffect(() => {
    props.messages().length
    const seq = ++gitRefreshSeq
    const id = setTimeout(() => {
      void readGitSnapshot().then((snapshot) => {
        if (seq !== gitRefreshSeq) return
        setGitFiles(snapshot.files)
        setBranch(snapshot.branch)
        setCommits(snapshot.commits)
      })
    }, 300)
    return () => clearTimeout(id)
  })

  // Force refresh when gitRefreshKey changes (external trigger via palette)
  createEffect(() => {
    props.gitRefreshKey
    const seq = ++gitRefreshSeq
    void readGitSnapshot().then((snapshot) => {
      if (seq !== gitRefreshSeq) return
      setGitFiles(snapshot.files)
      setBranch(snapshot.branch)
      setCommits(snapshot.commits)
    })
  })

  const modelCfg = createMemo(() => getModelConfig(props.model))

  const tokenUsage = createMemo(() => {
    let inputChars = 0
    let outputChars = 0
    for (const msg of props.messages()) {
      const length = (msg.content ?? "").length
      if (msg.role === "user" || msg.role === "system") inputChars += length
      if (msg.role === "assistant") outputChars += length
    }
    const input = Math.max(0, Math.round(inputChars / 4))
    const output = Math.max(0, Math.round(outputChars / 4))
    return { input, output, total: input + output }
  })

  const totalInputTokens = createMemo(() => tokenUsage().input)
  const totalOutputTokens = createMemo(() => tokenUsage().output)
  const totalTokens = createMemo(() => tokenUsage().total)
  const contextPercent = createMemo(() => {
    const limit = modelCfg().contextLimit
    if (!limit) return 0
    return Math.round((totalTokens() / limit) * 100)
  })
  const sessionCost = createMemo(() => estimateCost(props.model, totalInputTokens(), totalOutputTokens()))

  const totalAdditions = createMemo(() => gitFiles().reduce((sum, f) => sum + f.additions, 0))
  const totalDeletions = createMemo(() => gitFiles().reduce((sum, f) => sum + f.deletions, 0))
  const compacted = createMemo(() => props.messages().some(isCompactSummaryMessage))

  const percentColor = () => {
    const pct = contextPercent()
    if (pct >= 90) return "#f85149"
    if (pct >= 70) return "#d29922"
    return props.theme.muted
  }

  return (
    <scrollbox
      width={props.width}
      height="100%"
      border={["left"]}
      borderColor={props.theme.border}
      backgroundColor={props.theme.surface}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      scrollY={true}
      flexDirection="column"
    >
      <box flexDirection="column" gap={1}>
        <box flexDirection="column">
          <Show when={props.sessionTitle}>
            <box flexDirection="row" gap={1}>
              <text style={{ fg: props.theme.accent }}>Session</text>
              <Show when={props.sessionId}>
                {(() => {
                  const active = isSessionActive(props.sessionId!)
                  const info = active ? getSessionActiveInfo(props.sessionId!) : null
                  const isOwn = info?.pid === process.pid
                  // Read lockTick to create reactive dependency for auto-refresh
                  void lockTick()
                  if (active) {
                    return <text style={{ fg: props.theme.muted }}>{isOwn ? "~ active" : "⚡ in use"}</text>
                  }
                  return <></>
                })()}
              </Show>
            </box>
            <text style={{ fg: props.theme.muted }}>{props.sessionTitle}</text>
            <Show when={compacted()}>
              <text style={{ fg: props.theme.accent }}>Compacted</text>
            </Show>
          </Show>
        </box>

        <Show when={props.todos && props.todos().length > 0}>
          <box flexDirection="column">
            <box flexDirection="row" gap={1}>
              <text style={{ fg: props.theme.accent }}>Tasks</text>
              <text style={{ fg: props.theme.muted }}>
                {props.todos!().filter(t => t.status === "completed").length}/{props.todos!().length}
              </text>
            </box>
            <For each={props.todos!()}>
              {(todo) => {
                const icon = todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "•" : " "
                const color = todo.status === "completed"
                  ? props.theme.muted
                  : todo.status === "in_progress"
                  ? "#d29922"
                  : props.theme.muted
                const maxTextWidth = Math.max(1, props.width - 5)
                const text = todo.content.length > maxTextWidth
                  ? todo.content.slice(0, maxTextWidth - 1) + "…"
                  : todo.content
                return (
                  <box flexDirection="row" gap={1}>
                    <text style={{ fg: color }}>[{icon}]</text>
                    <text style={{ fg: color }} wrapMode="none">{text}</text>
                  </box>
                )
              }}
            </For>
          </box>
        </Show>

        <box flexDirection="column">
          <text style={{ fg: props.theme.accent }}>Context</text>
          <text style={{ fg: props.theme.muted }}>
            {fmtTokens(totalTokens())} / {fmtTokens(modelCfg().contextLimit)} tokens
          </text>
          <Show when={contextPercent() > 0}>
            <text style={{ fg: percentColor() }}>{contextPercent()}% used</text>
          </Show>
          <Show when={sessionCost() > 0}>
            <text style={{ fg: props.theme.muted }}>{fmtCost(sessionCost())} spent</text>
          </Show>
        </box>

        <Show when={branch()}>
          <box flexDirection="column">
            <text style={{ fg: props.theme.accent }}>Branch</text>
            <text style={{ fg: props.theme.muted }}>{branch()}</text>
          </box>
        </Show>

        <Show when={props.cwd}>
          <box flexDirection="column">
            <text style={{ fg: props.theme.accent }}>Directory</text>
            <text style={{ fg: props.theme.muted }} wrapMode="none">
              {truncatePath(props.cwd ?? "", Math.max(1, props.width - 4))}
            </text>
          </box>
        </Show>

        <Show when={commits().length > 0}>
          <box flexDirection="column">
            <box flexDirection="row" gap={1}>
              <text
                style={{ fg: props.theme.accent }}
                onMouseDown={() => setCommitsCollapsed(c => !c)}
              >
                {commitsCollapsed() ? "+" : "-"} Commits
              </text>
            </box>
            <Show when={!commitsCollapsed()}>
              <For each={commits()}>
                {(commit) => (
                  <box flexDirection="row" gap={1}>
                    <text style={{ fg: "#d2a8ff" }}>{commit.hash}</text>
                    <text style={{ fg: props.theme.muted }} wrapMode="none">
                      {commit.subject.slice(0, Math.max(1, props.width - 10))}
                    </text>
                  </box>
                )}
              </For>
            </Show>
          </box>
        </Show>

        <Show when={gitFiles().length > 0}>
          <box flexDirection="column">
            <box flexDirection="row" gap={1}>
              <text style={{ fg: props.theme.accent }}>Changed Files</text>
              <text style={{ fg: "#7ee787" }}>+{totalAdditions()}</text>
              <text style={{ fg: "#f85149" }}>-{totalDeletions()}</text>
            </box>
            <For each={gitFiles()}>
              {(file) => (
                <box flexDirection="row" justifyContent="space-between">
                  <box flexDirection="row" gap={1} flexShrink={1}>
                    <Show when={file.status === "added"}>
                      <text style={{ fg: "#7ee787" }}>+</text>
                    </Show>
                    <text
                      style={{ fg: file.status === "added" ? "#7ee787" : props.theme.muted }}
                      wrapMode="none"
                    >
                      {truncatePath(file.path, props.width - 8)}
                    </text>
                  </box>
                  <box flexDirection="row" flexShrink={0} gap={1}>
                    <Show when={file.additions > 0}>
                      <text style={{ fg: "#7ee787" }}>+{file.additions}</text>
                    </Show>
                    <Show when={file.deletions > 0}>
                      <text style={{ fg: "#f85149" }}>-{file.deletions}</text>
                    </Show>
                  </box>
                </box>
              )}
            </For>
          </box>
        </Show>
      </box>
    </scrollbox>
  )
}
