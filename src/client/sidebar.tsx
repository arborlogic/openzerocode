import { createSignal, createEffect, createMemo, For, Show } from "solid-js"
import { execFileSync } from "node:child_process"
import type { Message } from "../provider/types"
import { getModelConfig, estimateTokens, estimateCost } from "../provider/models"
import { isCompactSummaryMessage } from "./session-compact"
import { isSessionActive, getSessionActiveInfo } from "./sessions"

type GitFile = {
  path: string
  additions: number
  deletions: number
}

type GitCommit = {
  hash: string
  subject: string
}

let lastGitRead = 0
let lastGitResult: GitFile[] = []

function readGitDiff(): GitFile[] {
  const now = Date.now()
  if (now - lastGitRead < 2000) return lastGitResult
  lastGitRead = now
  try {
    const out = execFileSync("git", ["diff", "--numstat", "HEAD"], {
      encoding: "utf-8",
      timeout: 1000,
      stdio: ["pipe", "pipe", "ignore"],
    })
    lastGitResult = out.trim().split("\n").filter(Boolean).map((line) => {
      const [add = "0", del = "0", ...rest] = line.split("\t")
      const path = rest.join("\t")
      return { path, additions: parseInt(add) || 0, deletions: parseInt(del) || 0 }
    })
    return lastGitResult
  } catch {
    return []
  }
}

function readGitBranch(): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf-8",
      timeout: 1000,
      stdio: ["pipe", "pipe", "ignore"],
    })
    return out.trim() || null
  } catch {
    return null
  }
}

function readRecentCommits(n: number): GitCommit[] {
  try {
    const out = execFileSync("git", ["log", "--oneline", `-${n}`], {
      encoding: "utf-8",
      timeout: 1000,
      stdio: ["pipe", "pipe", "ignore"],
    })
    return out.trim().split("\n").filter(Boolean).map((line) => {
      const spaceIdx = line.indexOf(" ")
      const hash = spaceIdx >= 0 ? line.slice(0, spaceIdx) : line
      const subject = spaceIdx >= 0 ? line.slice(spaceIdx + 1) : ""
      return { hash, subject }
    })
  } catch {
    return []
  }
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
}) {
  const [gitFiles, setGitFiles] = createSignal<GitFile[]>([])
  const [branch, setBranch] = createSignal<string | null>(readGitBranch())
  const [commits, setCommits] = createSignal<GitCommit[]>(readRecentCommits(3))
  const [commitsCollapsed, setCommitsCollapsed] = createSignal(false)

  // Poll session lock status every 3s while sidebar is visible
  const [lockTick, setLockTick] = createSignal(0)
  createEffect(() => {
    const id = setInterval(() => setLockTick(v => v + 1), 3000)
    return () => clearInterval(id)
  })

  createEffect(() => {
    props.messages()
    setGitFiles(readGitDiff())
    setBranch(readGitBranch())
    setCommits(readRecentCommits(3))
  })

  const modelCfg = createMemo(() => getModelConfig(props.model))

  const totalInputTokens = createMemo(() =>
    estimateTokens(
      props.messages()
        .filter(m => m.role === "user" || m.role === "system")
        .map(m => m.content ?? "")
        .join("")
    )
  )

  const totalOutputTokens = createMemo(() =>
    estimateTokens(
      props.messages()
        .filter(m => m.role === "assistant")
        .map(m => m.content ?? "")
        .join("")
    )
  )

  const totalTokens = createMemo(() => totalInputTokens() + totalOutputTokens())
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
              <text style={{ fg: props.theme.accent }}>Modified Files</text>
              <text style={{ fg: "#7ee787" }}>+{totalAdditions()}</text>
              <text style={{ fg: "#f85149" }}>-{totalDeletions()}</text>
            </box>
            <For each={gitFiles()}>
              {(file) => (
                <box flexDirection="row" justifyContent="space-between">
                  <text style={{ fg: props.theme.muted }} wrapMode="none" flexShrink={1}>
                    {truncatePath(file.path, props.width - 8)}
                  </text>
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
