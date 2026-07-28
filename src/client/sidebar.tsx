import { createSignal, createEffect, createMemo, For, Show } from "solid-js"
import type { Message, ModelInfo } from "../provider/types"
import { getModelConfig, estimateCost } from "../provider/models"
import { isCompactSummaryMessage, estimateContextTokens } from "./session-compact"
import { isSessionActive, getSessionActiveInfo } from "./sessions"
import type { TodoItem } from "../tool/todo"
import { isEnabled, isConnected, getConfiguredSessionId } from "../browser/geass-client"
import { readGitSnapshot, type GitCommit, type GitFile } from "./git-snapshot"
import stringWidth from "string-width"

function truncateStart(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ""
  if (stringWidth(text) <= maxWidth) return text
  let width = 1
  let result = ""
  for (const char of [...text].reverse()) {
    const charWidth = stringWidth(char)
    if (width + charWidth > maxWidth) break
    width += charWidth
    result = char + result
  }
  return "…" + result
}

function truncateEnd(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ""
  if (stringWidth(text) <= maxWidth) return text
  let width = 1
  let result = ""
  for (const char of [...text]) {
    const charWidth = stringWidth(char)
    if (width + charWidth > maxWidth) break
    width += charWidth
    result += char
  }
  return result + "…"
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

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export type { GitFile }

type FileItem =
  | { kind: "file"; file: GitFile }
  | { kind: "folder"; name: string; files: GitFile[]; additions: number; deletions: number; status: GitFile["status"] }

function buildFileItems(files: GitFile[]): FileItem[] {
  const folderFiles = new Map<string, GitFile[]>()
  const result: FileItem[] = []

  for (const file of files) {
    const slashIdx = file.path.indexOf("/")
    if (slashIdx === -1) {
      result.push({ kind: "file", file })
    } else {
      const folder = file.path.slice(0, slashIdx)
      if (!folderFiles.has(folder)) {
        const entry: FileItem & { kind: "folder" } = {
          kind: "folder",
          name: folder,
          files: [],
          additions: 0,
          deletions: 0,
          status: "modified",
        }
        folderFiles.set(folder, entry.files)
        result.push(entry)
      }
      folderFiles.get(folder)!.push(file)
    }
  }

  // Compute per-folder aggregates
  for (const item of result) {
    if (item.kind !== "folder") continue
    item.additions = item.files.reduce((s, f) => s + f.additions, 0)
    item.deletions = item.files.reduce((s, f) => s + f.deletions, 0)
    item.status = item.files.some(f => f.status === "added") ? "added"
      : item.files.some(f => f.status === "deleted") ? "deleted"
      : "modified"
  }

  return result
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
  modelInfo?: ModelInfo
  provider: string
  sessionTitle?: string
  sessionId?: string
  /** Compaction summary injected into provider requests but not stored in messages. */
  compactionSummary?: string
  cwd?: string
  version?: string
  /** Increment to force a git snapshot refresh from outside the component. */
  gitRefreshKey?: number
  /** Increment to trigger GEASS status re-read. */
  geassRevision?: number
  /** Called when user clicks a changed file to view its diff. */
  onFileClick?: (file: GitFile) => void
}) {
  const [gitFiles, setGitFiles] = createSignal<GitFile[]>([])
  const [branch, setBranch] = createSignal<string | null>(null)
  const [commits, setCommits] = createSignal<GitCommit[]>([])
  const [commitsCollapsed, setCommitsCollapsed] = createSignal(false)
  const [expandedFolders, setExpandedFolders] = createSignal<Set<string>>(new Set())

  let scrollboxRef: any = null

  // Force scrollbox to recalculate its scroll range after content changes.
  // The opentui render loop drops requestRender() calls made mid-frame.
  // We directly call the private recalculateBarProps to update scrollSize/viewportSize.
  const scheduleScrollRecalc = () => {
    setTimeout(() => {
      if (scrollboxRef) {
        ;(scrollboxRef as any).recalculateBarProps?.()
      }
    }, 50)
  }

  const toggleFolder = (name: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
    scheduleScrollRecalc()
  }

  const fileItems = createMemo(() => buildFileItems(gitFiles()))
  let gitRefreshSeq = 0

  // When git files change (new snapshot loaded), the content height changes.
  // Schedule a scroll recalc so the scrollbox picks up the new content size.
  createEffect(() => {
    gitFiles()
    scheduleScrollRecalc()
  })

  // Poll session lock status every 6s while sidebar is visible. This still keeps
  // the "in use" badge reasonably fresh but cuts idle wakeups in half.
  const [lockTick, setLockTick] = createSignal(0)
  createEffect(() => {
    const id = setInterval(() => setLockTick(v => v + 1), 6000)
    return () => clearInterval(id)
  })

  const refreshGitSnapshot = (delayMs: number) => {
    const cwd = props.cwd ?? process.cwd()
    const seq = ++gitRefreshSeq
    const id = setTimeout(() => {
      void readGitSnapshot(cwd).then((snapshot) => {
        if (seq !== gitRefreshSeq) return
        setGitFiles(snapshot.files)
        setBranch(snapshot.branch)
        setCommits(snapshot.commits)
      })
    }, delayMs)
    return () => clearTimeout(id)
  }

  const gitSnapshotTrigger = createMemo(() => {
    const msgs = props.messages()
    const last = msgs.at(-1)
    const toolParts = last?.parts?.filter((part) => part.type === "tool-call" || part.type === "tool-result").length ?? 0
    return `${msgs.length}:${last?.role ?? ""}:${last?.content?.length ?? 0}:${toolParts}`
  })

  createEffect(() => {
    gitSnapshotTrigger()
    return refreshGitSnapshot(300)
  })

  // Force refresh when gitRefreshKey changes (external trigger via palette)
  createEffect(() => {
    void props.gitRefreshKey
    return refreshGitSnapshot(0)
  })

  createEffect(() => {
    void props.cwd
    return refreshGitSnapshot(0)
  })

  const modelCfg = createMemo(() => getModelConfig(props.model, props.modelInfo))

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
    return { input, output }
  })

  const totalInputTokens = createMemo(() => tokenUsage().input)
  const totalOutputTokens = createMemo(() => tokenUsage().output)
  // Context total must match the compaction-warning trigger: JSON.stringify the
  // full message objects (parts, tool calls, reasoning) so tool-heavy sessions
  // are not under-reported as 1% while the warning fires.
  const totalTokens = createMemo(() => estimateContextTokens(props.messages(), "", props.compactionSummary))
  const contextPercent = createMemo(() => {
    const limit = modelCfg().contextLimit
    if (!limit) return 0
    const percent = (totalTokens() / limit) * 100
    // Preserve visibility after compaction: a non-empty context can be below
    // 0.5%, which rounds to 0 and would otherwise hide this indicator.
    if (percent > 0 && percent < 1) return Math.max(0.1, Number(percent.toFixed(1)))
    return Math.round(percent)
  })
  const sessionCost = createMemo(() => estimateCost(props.model, totalInputTokens(), totalOutputTokens()))

  const totalAdditions = createMemo(() => gitFiles().reduce((sum, f) => sum + f.additions, 0))
  const totalDeletions = createMemo(() => gitFiles().reduce((sum, f) => sum + f.deletions, 0))
  const fileCountsByStatus = createMemo(() => gitFiles().reduce((counts, file) => {
    counts[file.status] += 1
    return counts
  }, { added: 0, deleted: 0, modified: 0 } satisfies Record<GitFile["status"], number>))
  const compacted = createMemo(() => props.messages().some(isCompactSummaryMessage))

  const percentColor = () => {
    const pct = contextPercent()
    if (pct >= 90) return "#f85149"
    if (pct >= 70) return "#d29922"
    return props.theme.muted
  }

  return (
    <box
      width={props.width}
      border={["left"]}
      borderColor={props.theme.border}
      backgroundColor={props.theme.surface}
      flexDirection="column"
    >
      {/* Scrollable upper content */}
      <scrollbox
        ref={(node) => { scrollboxRef = node }}
        flexGrow={1}
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        scrollY={true}
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
            <Show when={props.sessionId}>
              <text style={{ fg: props.theme.muted }} wrapMode="none">
                {truncateStart(props.sessionId!, Math.max(1, props.width - 4))}
              </text>
            </Show>
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
                const text = truncateEnd(todo.content, maxTextWidth)
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

        <Show when={isEnabled()}>
          {(() => {
            void props.geassRevision
            return (
              <box flexDirection="column">
                <text style={{ fg: props.theme.accent }}>GEASS</text>
                <text style={{ fg: isConnected() ? "#7ee787" : "#f85149" }}>
                  {isConnected() ? "● Online" : "○ Offline"}
                </text>
                <Show when={getConfiguredSessionId()}>
                  <text style={{ fg: props.theme.muted }} wrapMode="none">
                    window {truncateStart(getConfiguredSessionId()!, Math.max(1, props.width - 11))}
                  </text>
                </Show>
              </box>
            )
          })()}
        </Show>

        <Show when={branch()}>
          <box flexDirection="column">
            <text style={{ fg: props.theme.accent }}>Branch</text>
            <text style={{ fg: props.theme.muted }} wrapMode="none">
              {truncateStart(branch() ?? "", Math.max(1, props.width - 4))}
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
                      {truncateEnd(commit.subject, Math.max(1, props.width - 10))}
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
              <text style={{ fg: props.theme.muted }}>{gitFiles().length}</text>
              <text style={{ fg: "#7ee787" }}>+{totalAdditions()}</text>
              <text style={{ fg: "#f85149" }}>-{totalDeletions()}</text>
            </box>
            <text style={{ fg: props.theme.muted }} wrapMode="none">
              {(() => {
                const counts = fileCountsByStatus()
                const parts = [
                  counts.modified > 0 ? pluralize(counts.modified, "modified") : "",
                  counts.added > 0 ? pluralize(counts.added, "added") : "",
                  counts.deleted > 0 ? pluralize(counts.deleted, "deleted") : "",
                ].filter(Boolean)
                return truncateEnd(parts.join(", "), Math.max(1, props.width - 4))
              })()}
            </text>
            <For each={fileItems()}>
              {(item) => {
                if (item.kind === "file") {
                  const file = item.file
                  const color = file.status === "added" ? "#7ee787" : file.status === "deleted" ? "#f85149" : props.theme.muted
                  return (
                    <box flexDirection="row" justifyContent="space-between" onMouseDown={() => props.onFileClick?.(file)}>
                      <box flexDirection="row" gap={1} flexShrink={1}>
                        <Show when={file.status === "added"}>
                          <text style={{ fg: "#7ee787" }}>+</text>
                        </Show>
                        <Show when={file.status === "deleted"}>
                          <text style={{ fg: "#f85149" }}>-</text>
                        </Show>
                        <text style={{ fg: color }} wrapMode="none">
                          {truncateStart(file.path, props.width - 8)}
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
                  )
                }

                // Folder item
                const folderColor = item.status === "added" ? "#7ee787" : item.status === "deleted" ? "#f85149" : props.theme.muted
                const isExpanded = () => expandedFolders().has(item.name)
                return (
                  <box flexDirection="column">
                    <box flexDirection="row" justifyContent="space-between" onMouseDown={() => toggleFolder(item.name)}>
                      <box flexDirection="row" gap={1} flexShrink={1}>
                        <text style={{ fg: folderColor }}>{isExpanded() ? "▼" : "▶"}</text>
                        <text style={{ fg: folderColor }} wrapMode="none">
                          {truncateStart(item.name + "/", props.width - 8)}
                        </text>
                      </box>
                      <box flexDirection="row" flexShrink={0} gap={1}>
                        <Show when={item.additions > 0}>
                          <text style={{ fg: "#7ee787" }}>+{item.additions}</text>
                        </Show>
                        <Show when={item.deletions > 0}>
                          <text style={{ fg: "#f85149" }}>-{item.deletions}</text>
                        </Show>
                      </box>
                    </box>
                    <Show when={isExpanded()}>
                      <For each={item.files}>
                        {(file) => {
                          const fileColor = file.status === "added" ? "#7ee787" : file.status === "deleted" ? "#f85149" : props.theme.muted
                          const displayName = file.path.slice(item.name.length + 1)
                          return (
                            <box flexDirection="row" justifyContent="space-between" onMouseDown={() => props.onFileClick?.(file)}>
                              <box flexDirection="row" gap={1} flexShrink={1}>
                                <text style={{ fg: props.theme.muted }}>  </text>
                                <Show when={file.status === "added"}>
                                  <text style={{ fg: "#7ee787" }}>+</text>
                                </Show>
                                <Show when={file.status === "deleted"}>
                                  <text style={{ fg: "#f85149" }}>-</text>
                                </Show>
                                <text style={{ fg: fileColor }} wrapMode="none">
                                  {truncateStart(displayName, props.width - 10)}
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
                          )
                        }}
                      </For>
                    </Show>
                  </box>
                )
              }}
            </For>
          </box>
        </Show>
      </box>
      </scrollbox>

      {/* Fixed bottom: Directory + Version */}
      <box flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1} paddingBottom={1}>
        <Show when={props.cwd}>
          <box flexDirection="column">
            <text style={{ fg: props.theme.accent }}>Directory</text>
            <text style={{ fg: props.theme.muted }} wrapMode="none">
              {truncateStart(props.cwd ?? "", Math.max(1, props.width - 4))}
            </text>
          </box>
        </Show>
        <Show when={props.version}>
          <box flexDirection="row" gap={1}>
            <text style={{ fg: props.theme.accent }}>●</text>
            <text style={{ fg: "#ffffff" }}>Zero</text>
            <text style={{ fg: props.theme.muted }}>{props.version}</text>
          </box>
        </Show>
      </box>
    </box>
  )
}
