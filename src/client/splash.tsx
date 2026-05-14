import type { SessionMeta } from "./sessions"

export type SplashProps = {
  selectedIndex: number  // -1 = none, 0+ = session row highlighted
  sessions: SessionMeta[]
  layoutMode: "horizontal" | "vertical"
  model: string
  provider: string
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

export function SplashScreen(props: SplashProps) {
  const version =
    (typeof process !== "undefined" &&
      (process.env as Record<string, string>)["__OPENZEROCODE_VERSION__"]) ||
    "0.0.0-dev"

  const recent = () => props.sessions.slice(0, MAX_SESSIONS)

  // Content column width — narrower on vertical (portrait) terminals
  const W = () => props.layoutMode === "vertical" ? 52 : 68

  const inputBorderColor = () =>
    props.selectedIndex === -1 ? T.accent : T.borderBright

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
      >
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
      </box>

      {/* ── Recent sessions ── */}
      {recent().length > 0
        ? (
          <box flexDirection="column" width={W()} marginTop={1}>
            {/* Header */}
            <box flexDirection="row" paddingLeft={1} paddingRight={1} marginBottom={0}>
              <text style={{ fg: T.borderBright }}>{"Recent"}</text>
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
                >
                  {/* Index hint */}
                  <text style={{ fg: active() ? T.warning : T.border }}>
                    {active() ? "›" : " "}
                    {`${i + 1}  `}
                  </text>
                  {/* Title */}
                  <box flexGrow={1}>
                    <text style={{ fg: active() ? T.text : T.muted }}>
                      {session.title.length > W() - 18
                        ? session.title.slice(0, W() - 21) + "…"
                        : session.title}
                    </text>
                  </box>
                  {/* Time */}
                  <text style={{ fg: T.border }}>
                    {timeAgo(session.updatedAt)}
                  </text>
                </box>
              )
            })}
          </box>
        )
        : null}

      <box flexGrow={4} />

      <text style={{ fg: T.border }}>{`v${version}`}</text>
      <box flexGrow={1} />
    </box>
  )
}
