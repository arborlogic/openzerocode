import { createSignal, createMemo, For, Show } from "solid-js"
import {
  loadUsageEntries,
  getDailyBuckets,
  getHourlyBuckets,
  getSessionBreakdown,
  aggregateEntries,
  fmtTokens,
  type DailyBucket,
  type HourlyBucket,
  type AggregatedUsage,
  type SessionBreakdown,
  type SessionRequestRow,
} from "./usage-stats"
import { listSessions } from "./sessions"

export type ViewMode = "sessions" | "global" | "daily" | "hourly"
export const VIEW_MODES: ViewMode[] = ["sessions", "global", "daily", "hourly"]
type GroupMode = "provider" | "model"

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function fmtGroup(item: AggregatedUsage, groupMode: GroupMode): string {
  if (groupMode === "model") return item.model
  return item.keyName === "anonymous" ? item.provider : `${item.provider} / ${item.keyName}`
}

function AggRow(props: {
  item: AggregatedUsage
  groupMode: GroupMode
  width: number
  theme: { text: string; muted: string; accent: string }
}) {
  const label = () => fmtGroup(props.item, props.groupMode)
  const labelMax = () => Math.max(10, props.width - 36)
  const truncated = () => {
    const l = label()
    return l.length > labelMax() ? l.slice(0, labelMax() - 1) + "…" : l
  }

  return (
    <box flexDirection="row" gap={1}>
      <text style={{ fg: props.theme.muted }} wrapMode="none">
        {truncated().padEnd(labelMax())}
      </text>
      <text style={{ fg: props.theme.accent }}>
        {`in:${fmtTokens(props.item.inputTokens).padStart(6)}`}
      </text>
      <text style={{ fg: "#7ee787" }}>
        {`out:${fmtTokens(props.item.outputTokens).padStart(6)}`}
      </text>
      <text style={{ fg: props.theme.muted }}>
        {`×${String(props.item.requestCount).padStart(3)}`}
      </text>
    </box>
  )
}

function SessionRow(props: {
  breakdown: SessionBreakdown
  title: string
  width: number
  theme: { text: string; muted: string; accent: string; accentDim: string }
}) {
  const keyLabel = () =>
    props.breakdown.keyName === "anonymous"
      ? props.breakdown.provider
      : `${props.breakdown.provider} / ${props.breakdown.keyName}`

  const titleMax = () => Math.max(10, props.width - 30)
  const truncTitle = () => {
    const t = props.title
    return t.length > titleMax() ? t.slice(0, titleMax() - 1) + "…" : t
  }

  return (
    <box flexDirection="column" marginBottom={1}>
      {/* Session header */}
      <box flexDirection="row" gap={2}>
        <text style={{ fg: props.theme.text }} wrapMode="none">
          {truncTitle()}
        </text>
        <text style={{ fg: props.theme.muted }} wrapMode="none">
          {`[${props.breakdown.model}]`}
        </text>
      </box>
      <box flexDirection="row" gap={2}>
        <text style={{ fg: props.theme.muted }}>{keyLabel()}</text>
        <text style={{ fg: props.theme.muted }}>
          {`${props.breakdown.totalRequests} requests  •  ${fmtTokens(props.breakdown.totalInputTokens + props.breakdown.totalOutputTokens)} tokens total`}
        </text>
      </box>

      {/* Last N requests */}
      <For each={props.breakdown.recentEntries}>
        {(row: SessionRequestRow, idx) => (
          <box flexDirection="row" gap={2} paddingLeft={2}>
            <text style={{ fg: props.theme.muted }}>
              {`#${props.breakdown.totalRequests - idx()}`}
            </text>
            <text style={{ fg: props.theme.muted }}>{fmtTime(row.timestamp)}</text>
            <text style={{ fg: props.theme.accent }}>
              {`in:${fmtTokens(row.inputTokens).padStart(6)}`}
            </text>
            <text style={{ fg: "#7ee787" }}>
              {`out:${fmtTokens(row.outputTokens).padStart(5)}`}
            </text>
          </box>
        )}
      </For>

      <Show when={props.breakdown.totalRequests > props.breakdown.recentEntries.length}>
        <box paddingLeft={2}>
          <text style={{ fg: props.theme.muted }}>
            {`… ${props.breakdown.totalRequests - props.breakdown.recentEntries.length} more`}
          </text>
        </box>
      </Show>
    </box>
  )
}

export function UsageDashboard(props: {
  onClose: () => void
  viewMode: ViewMode
  onViewMode: (v: ViewMode) => void
  theme: {
    background: string
    surface: string
    border: string
    text: string
    muted: string
    accent: string
    accentDim: string
  }
  width: number
  height: number
}) {
  const viewMode = () => props.viewMode
  const setViewMode = props.onViewMode
  const [groupMode, setGroupMode] = createSignal<GroupMode>("provider")

  const entries = createMemo(() => loadUsageEntries())

  const totalStats = createMemo(() => aggregateEntries(entries()))
  const dailyBuckets = createMemo(() => getDailyBuckets(entries()))
  const hourlyBuckets = createMemo(() => getHourlyBuckets(entries()))
  const sessionBreakdowns = createMemo(() => getSessionBreakdown(entries(), 5))

  const sessionTitleMap = createMemo(() => {
    const all = listSessions({ directory: null })
    const m = new Map<string, string>()
    for (const s of all) m.set(s.id, s.title)
    return m
  })

  const panelWidth = () => Math.min(props.width - 4, 92)
  const panelHeight = () => Math.min(props.height - 4, 42)
  const innerWidth = () => panelWidth() - 4

  const totalTokens = createMemo(() =>
    entries().reduce((s, e) => s + e.inputTokens + e.outputTokens, 0)
  )
  const totalRequests = createMemo(() => entries().length)

  const showGroup = () => viewMode() !== "sessions" && viewMode() !== "global"

  return (
    <box
      position="absolute"
      top={Math.floor((props.height - panelHeight()) / 2)}
      left={Math.floor((props.width - panelWidth()) / 2)}
      width={panelWidth()}
      height={panelHeight()}
      zIndex={200}
      flexDirection="column"
      backgroundColor={props.theme.surface}
      border={["top", "bottom", "left", "right"]}
      borderColor={props.theme.border}
    >
      {/* Header */}
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        borderColor={props.theme.border}
        border={["bottom"]}
      >
        <box flexDirection="row" gap={2}>
          <text style={{ fg: props.theme.accent }}>Usage Dashboard</text>
          <text style={{ fg: props.theme.muted }}>
            {`total: ${fmtTokens(totalTokens())} tokens  •  ${totalRequests()} requests`}
          </text>
        </box>
        <text style={{ fg: props.theme.muted }} onMouseDown={() => props.onClose()}>
          [Esc]
        </text>
      </box>

      {/* Controls */}
      <box
        flexDirection="row"
        gap={3}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        border={["bottom"]}
        borderColor={props.theme.border}
      >
        <box flexDirection="row" gap={1}>
          <text style={{ fg: props.theme.muted }}>View:</text>
          <text
            style={{ fg: viewMode() === "sessions" ? props.theme.accent : props.theme.muted }}
            onMouseDown={() => setViewMode("sessions")}
          >
            {viewMode() === "sessions" ? "[Sessions]" : " Sessions "}
          </text>
          <text
            style={{ fg: viewMode() === "global" ? props.theme.accent : props.theme.muted }}
            onMouseDown={() => setViewMode("global")}
          >
            {viewMode() === "global" ? "[Global]" : " Global "}
          </text>
          <text
            style={{ fg: viewMode() === "daily" ? props.theme.accent : props.theme.muted }}
            onMouseDown={() => setViewMode("daily")}
          >
            {viewMode() === "daily" ? "[Daily]" : " Daily "}
          </text>
          <text
            style={{ fg: viewMode() === "hourly" ? props.theme.accent : props.theme.muted }}
            onMouseDown={() => setViewMode("hourly")}
          >
            {viewMode() === "hourly" ? "[Hourly]" : " Hourly "}
          </text>
        </box>
        <Show when={showGroup()}>
          <box flexDirection="row" gap={1}>
            <text style={{ fg: props.theme.muted }}>Group:</text>
            <text
              style={{ fg: groupMode() === "provider" ? props.theme.accent : props.theme.muted }}
              onMouseDown={() => setGroupMode("provider")}
            >
              {groupMode() === "provider" ? "[Provider/Key]" : " Provider/Key "}
            </text>
            <text
              style={{ fg: groupMode() === "model" ? props.theme.accent : props.theme.muted }}
              onMouseDown={() => setGroupMode("model")}
            >
              {groupMode() === "model" ? "[Model]" : " Model "}
            </text>
          </box>
        </Show>
      </box>

      {/* Content */}
      <scrollbox
        flexGrow={1}
        minHeight={0}
        scrollY={true}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        flexDirection="column"
      >
        {/* Global view */}
        <Show when={viewMode() === "global"}>
          <Show when={totalStats().length === 0 && entries().length === 0}>
            <text style={{ fg: props.theme.muted }}>
              No usage data yet. Usage is recorded after each AI response.
            </text>
          </Show>
          <Show when={totalStats().length > 0}>
            <box flexDirection="row" gap={2} marginBottom={1}>
              <text style={{ fg: props.theme.text }}>All time</text>
              <text style={{ fg: props.theme.muted }}>
                {`${fmtTokens(totalTokens())} tokens  •  ${totalRequests()} requests`}
              </text>
            </box>
            <For each={totalStats()}>
              {(item: AggregatedUsage) => (
                <AggRow
                  item={item}
                  groupMode="provider"
                  width={innerWidth()}
                  theme={props.theme}
                />
              )}
            </For>
          </Show>
        </Show>

        {/* Sessions view */}
        <Show when={viewMode() === "sessions"}>
          <Show when={sessionBreakdowns().length === 0 && entries().length > 0}>
            <text style={{ fg: props.theme.muted }}>No session data available.</text>
          </Show>
          <For each={sessionBreakdowns()}>
            {(s: SessionBreakdown) => (
              <SessionRow
                breakdown={s}
                title={sessionTitleMap().get(s.sessionId) ?? s.sessionId}
                width={innerWidth()}
                theme={props.theme}
              />
            )}
          </For>
        </Show>

        {/* Daily view */}
        <Show when={viewMode() === "daily"}>
          <Show when={dailyBuckets().length === 0 && entries().length > 0}>
            <text style={{ fg: props.theme.muted }}>No data in the last 14 days.</text>
          </Show>
          <For each={dailyBuckets()}>
            {(bucket: DailyBucket) => (
              <box flexDirection="column" marginBottom={1}>
                <box flexDirection="row" gap={2}>
                  <text style={{ fg: props.theme.text }}>{bucket.date}</text>
                  <text style={{ fg: props.theme.muted }}>
                    {`${fmtTokens(bucket.totalTokens)} tokens total`}
                  </text>
                </box>
                <For each={bucket.items}>
                  {(item: AggregatedUsage) => (
                    <AggRow
                      item={item}
                      groupMode={groupMode()}
                      width={innerWidth()}
                      theme={props.theme}
                    />
                  )}
                </For>
              </box>
            )}
          </For>
        </Show>

        {/* Hourly view */}
        <Show when={viewMode() === "hourly"}>
          <Show when={hourlyBuckets().length === 0 && entries().length > 0}>
            <text style={{ fg: props.theme.muted }}>No data in the last 48 hours.</text>
          </Show>
          <For each={hourlyBuckets()}>
            {(bucket: HourlyBucket) => (
              <box flexDirection="column" marginBottom={1}>
                <box flexDirection="row" gap={2}>
                  <text style={{ fg: props.theme.text }}>{bucket.hour}</text>
                  <text style={{ fg: props.theme.muted }}>
                    {`${fmtTokens(bucket.totalTokens)} tokens total`}
                  </text>
                </box>
                <For each={bucket.items}>
                  {(item: AggregatedUsage) => (
                    <AggRow
                      item={item}
                      groupMode={groupMode()}
                      width={innerWidth()}
                      theme={props.theme}
                    />
                  )}
                </For>
              </box>
            )}
          </For>
        </Show>
      </scrollbox>

      {/* Footer */}
      <box
        paddingLeft={2}
        paddingRight={2}
        paddingTop={0}
        paddingBottom={1}
        border={["top"]}
        borderColor={props.theme.border}
      >
        <text style={{ fg: props.theme.muted }}>
          Tab / ← → switch views  •  1 Sessions  2 Global  3 Daily  4 Hourly  •  Esc close
        </text>
      </box>
    </box>
  )
}
