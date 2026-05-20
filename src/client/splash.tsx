import type { SessionMeta } from "./sessions"

export type SplashProps = {
  selectedIndex: number  // -1 = none, 0+ = session row, sessions.length = exit
  sessions: SessionMeta[]       // sessions for current cwd
  totalSessions: number         // total across all directories
  cwd: string
  layoutMode: "horizontal" | "vertical"
  model: string
  provider: string
  version: string
  onSelectSession?: (id: string) => void
  onNewSession?: () => void
  onExit?: () => void
}

const T = {
  bg:          "#0d1117",
  accent:      "#58a6ff",
  accentDim:   "#1f6feb",
  green:       "#3fb950",
  muted:       "#6e7681",
  text:        "#e6edf3",
  warning:     "#e3b341",
  border:      "#21262d",
  borderBright:"#30363d",
  selected:    "#161b22",
  danger:      "#f85149",
}

const OPEN_ART = [
  " ██████╗ ██████╗ ███████╗███╗   ██╗",
  "██╔═══██╗██╔══██╗██╔════╝████╗  ██║",
  "██║   ██║██████╔╝█████╗  ██╔██╗ ██║",
  "██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║",
  "╚██████╔╝██║     ███████╗██║ ╚████║",
  " ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝",
]

const ZEROCODE_ART = [
  "███████╗███████╗██████╗  ██████╗  ██████╗ ██████╗ ██████╗ ███████╗",
  "╚══███╔╝██╔════╝██╔══██╗██╔═══██╗██╔════╝██╔═══██╗██╔══██╗██╔════╝",
  "  ███╔╝ █████╗  ██████╔╝██║   ██║██║     ██║   ██║██║  ██║█████╗  ",
  " ███╔╝  ██╔══╝  ██╔══██╗██║   ██║██║     ██║   ██║██║  ██║██╔══╝  ",
  "███████╗███████╗██║  ██║╚██████╔╝╚██████╗╚██████╔╝██████╔╝███████╗",
  "╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝ ╚═════╝ ╚═════╝╚══════╝",
]

const MAX_SESSIONS = 5

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

function msgCountLabel(n: number): string {
  if (n === 0) return "no msgs"
  if (n === 1) return "1 msg"
  return `${n} msgs`
}

export function SplashScreen(props: SplashProps) {
  const recent = () => props.sessions.slice(0, MAX_SESSIONS)

  // Content column width — narrower on vertical (portrait) terminals
  const W = () => props.layoutMode === "vertical" ? 52 : 68

  const inputBorderColor = () =>
    props.selectedIndex === -1 ? T.accent : T.borderBright

  // EXIT row index = after all sessions
  const EXIT_IDX = () => recent().length

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      alignItems="center"
      backgroundColor={T.bg}
    >
      <box flexGrow={4} />

      {/* ── Logo ── */}
      <box flexDirection="column" alignItems="center">
        <text style={{ fg: T.accentDim }}>{OPEN_ART[0]}</text>
        <text style={{ fg: T.accentDim }}>{OPEN_ART[1]}</text>
        <text style={{ fg: T.accentDim }}>{OPEN_ART[2]}</text>
        <text style={{ fg: T.accentDim }}>{OPEN_ART[3]}</text>
        <text style={{ fg: T.accentDim }}>{OPEN_ART[4]}</text>
        <text style={{ fg: T.accentDim }}>{OPEN_ART[5]}</text>
      </box>
      <box flexDirection="column" alignItems="center">
        <text style={{ fg: T.accent }}>{ZEROCODE_ART[0]}</text>
        <text style={{ fg: T.accent }}>{ZEROCODE_ART[1]}</text>
        <text style={{ fg: T.accent }}>{ZEROCODE_ART[2]}</text>
        <text style={{ fg: T.accent }}>{ZEROCODE_ART[3]}</text>
        <text style={{ fg: T.accent }}>{ZEROCODE_ART[4]}</text>
        <text style={{ fg: T.accent }}>{ZEROCODE_ART[5]}</text>
      </box>

      <box flexGrow={2} />

      {/* ── Input box ── */}
      <box
        width={W()}
        flexDirection="column"
        border={["top", "right", "bottom", "left"]}
        borderColor={inputBorderColor()}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        gap={1}
        onMouseDown={() => props.onNewSession?.()}
      >
        {/* cwd row */}
        <box flexDirection="row" alignItems="center" gap={1}>
          <text style={{ fg: T.border }}>{"  ~"}</text>
          <text style={{ fg: T.borderBright }}>{props.cwd.replace(process.env.HOME ?? "", "~")}</text>
        </box>

        {/* Prompt row */}
        <box flexDirection="row" alignItems="center">
          <text style={{ fg: inputBorderColor() }}>{"›  "}</text>
          <text style={{ fg: T.muted }}>{"Ask anything…"}</text>
        </box>

        {/* Model / provider row */}
        <box flexDirection="row" alignItems="center" gap={1}>
          <text style={{ fg: T.accentDim }}>{"Build"}</text>
          <text style={{ fg: T.borderBright }}>{"·"}</text>
          <text style={{ fg: T.text }}>{props.model}</text>
          <text style={{ fg: T.borderBright }}>{"·"}</text>
          <text style={{ fg: T.muted }}>{props.provider}</text>
        </box>
      </box>

      {/* ── Keyboard hints (below input) ── */}
      <box flexDirection="row" width={W()} paddingLeft={1} marginTop={0} gap={2}>
        <box flexDirection="row" gap={1}>
          <text style={{ fg: T.warning }}>{"↵"}</text>
          <text style={{ fg: T.muted }}>{"new session"}</text>
        </box>
        {recent().length > 0
          ? (
            <box flexDirection="row" gap={1}>
              <text style={{ fg: T.warning }}>{"↑↓"}</text>
              <text style={{ fg: T.muted }}>{"select session"}</text>
            </box>
          )
          : null}
        <box flexDirection="row" gap={1}>
          <text style={{ fg: T.warning }}>{"q"}</text>
          <text style={{ fg: T.muted }}>{"exit"}</text>
        </box>
      </box>

      {/* ── Recent sessions ── */}
      {recent().length > 0
        ? (
          <box flexDirection="column" width={W()} marginTop={1}>
            {/* Header */}
            <box flexDirection="row" paddingLeft={1} paddingRight={1} marginBottom={0}>
              <text style={{ fg: T.borderBright }}>{"Recent"}</text>
              <text style={{ fg: T.border, flexGrow: 1 }}>{"  (this dir)"}</text>
              <text style={{ fg: T.border }}>{props.totalSessions > props.sessions.length ? `${props.sessions.length} / ${props.totalSessions}` : String(props.sessions.length)}</text>
            </box>
            <box border={["bottom"]} borderColor={T.border} />

            {/* Rows */}
            {recent().map((session, i) => {
              const active = () => i === props.selectedIndex
              return (
                <box
                  flexDirection="row"
                  backgroundColor={active() ? T.selected : undefined}
                  paddingLeft={1}
                  paddingRight={1}
                  onMouseDown={() => props.onSelectSession?.(session.id)}
                >
                  {/* Index hint */}
                  <text style={{ fg: active() ? T.warning : T.border }}>
                    {active() ? "›" : " "}
                    {`${i + 1}  `}
                  </text>
                  {/* Title */}
                  <box flexGrow={1}>
                    <text style={{ fg: active() ? T.text : T.muted }}>
                      {session.title.length > W() - 22
                        ? session.title.slice(0, W() - 25) + "…"
                        : session.title}
                    </text>
                  </box>
                  {/* Message count */}
                  <text style={{ fg: active() ? T.borderBright : T.border }}>
                    {`${msgCountLabel(session.messageCount)}  `}
                  </text>
                  {/* Time */}
                  <text style={{ fg: T.border }}>
                    {timeAgo(session.updatedAt)}
                  </text>
                </box>
              )
            })}

            {/* ── Exit row ── */}
            <box border={["top"]} borderColor={T.border} />
            <box
              flexDirection="row"
              backgroundColor={props.selectedIndex === EXIT_IDX() ? T.selected : undefined}
              paddingLeft={1}
              paddingRight={1}
              onMouseDown={() => props.onExit?.()}
            >
              <text style={{ fg: props.selectedIndex === EXIT_IDX() ? T.danger : T.border }}>
                {props.selectedIndex === EXIT_IDX() ? "› " : "  "}
              </text>
              <text style={{ fg: props.selectedIndex === EXIT_IDX() ? T.danger : T.muted }}>
                {"Exit"}
              </text>
            </box>
          </box>
        )
        : (
          /* No sessions yet — still show Exit */
          <box flexDirection="column" width={W()} marginTop={1}>
            <box border={["bottom"]} borderColor={T.border} />
            <box
              flexDirection="row"
              backgroundColor={props.selectedIndex === EXIT_IDX() ? T.selected : undefined}
              paddingLeft={1}
              paddingRight={1}
              onMouseDown={() => props.onExit?.()}
            >
              <text style={{ fg: props.selectedIndex === EXIT_IDX() ? T.danger : T.border }}>
                {props.selectedIndex === EXIT_IDX() ? "› " : "  "}
              </text>
              <text style={{ fg: props.selectedIndex === EXIT_IDX() ? T.danger : T.muted }}>
                {"Exit"}
              </text>
            </box>
          </box>
        )}

      <box flexGrow={4} />

      <text style={{ fg: T.muted }}>{`v${props.version}`}</text>
      <box flexGrow={1} />
    </box>
  )
}
