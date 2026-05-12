import { createSignal, createEffect, For, Show } from "solid-js"
import { execFileSync } from "node:child_process"
import type { Message } from "../provider/types"

type GitFile = {
  path: string
  additions: number
  deletions: number
}

function readGitDiff(): GitFile[] {
  try {
    const out = execFileSync("git", ["diff", "--numstat", "HEAD"], {
      encoding: "utf-8",
      timeout: 1000,
      stdio: ["pipe", "pipe", "ignore"],
    })
    return out.trim().split("\n").filter(Boolean).map((line) => {
      const [add = "0", del = "0", ...rest] = line.split("\t")
      const path = rest.join("\t")
      return {
        path,
        additions: parseInt(add) || 0,
        deletions: parseInt(del) || 0,
      }
    })
  } catch {
    return []
  }
}

export function Sidebar(props: {
  messages: () => Message[]
  sessionStart: Date
  theme: {
    text: string
    muted: string
    surface: string
    border: string
    accent: string
  }
  width: number
}) {
  const [gitFiles, setGitFiles] = createSignal<GitFile[]>([])

  createEffect(() => {
    props.messages()
    setGitFiles(readGitDiff())
  })

  const sessionTime = () =>
    props.sessionStart.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })

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
          <text style={{ fg: props.theme.accent }}>Session</text>
          <text style={{ fg: props.theme.muted }}>{sessionTime()}</text>
          <text style={{ fg: props.theme.muted }}>{props.messages().length} messages</text>
        </box>

        <box flexDirection="column">
          <text style={{ fg: props.theme.accent }}>Context</text>
          <text style={{ fg: props.theme.muted }}>
            {props.messages().filter(m => m.role === "user").length} user
          </text>
          <text style={{ fg: props.theme.muted }}>
            {props.messages().filter(m => m.role === "assistant").length} assistant
          </text>
          <text style={{ fg: props.theme.muted }}>
            {props.messages().filter(m => m.role === "tool").length} tool
          </text>
        </box>

        <Show when={gitFiles().length > 0}>
          <box flexDirection="column">
            <text style={{ fg: props.theme.accent }}>Modified Files</text>
            <For each={gitFiles()}>
              {(file) => (
                <box flexDirection="row" justifyContent="space-between">
                  <text style={{ fg: props.theme.muted }} wrapMode="none" flexShrink={1}>
                    {file.path}
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
