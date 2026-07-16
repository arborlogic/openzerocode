import { describe, it, mock } from "bun:test"
import assert from "node:assert"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { BUILTIN_COMMANDS, executeCommand, type CommandContext } from "./commands"
import type { DisplayBlock } from "./response-entry"
import type { Message } from "../provider/types"
import type { AutopilotMode } from "./autopilot"

function stubCtx(overrides?: Partial<CommandContext>): CommandContext {
  const notices: DisplayBlock[] = []
  const messages: Message[] = []
  return {
    currentProvider: "openrouter",
    setCurrentProvider: mock(() => Promise.resolve({ ok: true, message: "switched" })),
    currentModel: "openrouter/auto",
    setCurrentModel: mock(() => Promise.resolve({ ok: true, message: "model set" })),
    mode: "build" as const,
    setMode: mock(() => {}),
    reasoningEffort: "medium" as const,
    setReasoningEffort: mock(() => {}),
    messages: () => messages,
    setMessages: mock((fn: any) => {
      if (typeof fn === "function") fn(messages)
    }),
    setDraft: mock(() => {}),
    setNotices: mock((fn: any) => {
      if (typeof fn === "function") fn(notices)
      else notices.push(fn)
    }),
    showToast: mock(() => {}),
    exitApp: mock(() => Promise.resolve()),
    scrollBottom: mock(() => {}),
    switchSession: mock(() => {}),
    createNewSession: mock(() => {}),
    currentSessionId: mock(() => "ses_test123"),
    openSessionList: mock(() => {}),
    openQueuedMessages: mock(() => {}),
    openProviderList: mock(() => {}),
    openModelList: mock(() => {}),
    openHelp: mock(() => {}),
    openUsageDashboard: mock(() => {}),
    compactSession: mock(() => Promise.resolve()),
    viewCompactionSummary: mock(() => {}),
    exportCompactSession: mock(() => {}),
    refreshSessions: mock(() => {}),
    codexLogin: mock(() => Promise.resolve({ ok: true, message: "authorized" })),
    xaiLogin: mock(() => Promise.resolve({ ok: true, message: "authorized" })),
    getAutopilotMode: mock((): AutopilotMode => "off"),
    setAutopilotMode: mock(() => {}),
    ...overrides,
  }
}

describe("BUILTIN_COMMANDS", () => {
  it("includes expected commands", () => {
    const names = BUILTIN_COMMANDS.map((c) => c.name)
    assert.ok(names.includes("help"))
    assert.ok(names.includes("clear"))
    assert.ok(names.includes("provider"))
    assert.ok(names.includes("codex-login"))
    assert.ok(names.includes("xai-login"))
    assert.ok(names.includes("mode"))
    assert.ok(names.includes("memory"))
    assert.ok(names.includes("skills"))
    assert.ok(names.includes("skill"))
    assert.ok(names.includes("model"))
    assert.ok(names.includes("sessions"))
    assert.ok(names.includes("queue"))
    assert.ok(names.includes("tools"))
    assert.ok(names.includes("thinking"))
    assert.ok(names.includes("auto"))
    assert.ok(names.includes("autopilot"))
    assert.ok(!BUILTIN_COMMANDS.some((command) => command.name === "autoloop" || command.aliases?.includes("autoloop")))
    assert.ok(names.includes("commit"))
    assert.ok(names.includes("compact"))
    assert.ok(names.includes("export"))
    assert.ok(names.includes("exit"))
  })

  it("does not include removed commands", () => {
    const names = BUILTIN_COMMANDS.map((c) => c.name)
    assert.ok(!names.includes("info"))
    assert.ok(!names.includes("provider-key"))
    assert.ok(!names.includes("session"))
  })

  it("mode appears before model in list", () => {
    const names = BUILTIN_COMMANDS.map((c) => c.name)
    assert.ok(names.indexOf("mode") < names.indexOf("model"))
  })

  it("has unique names", () => {
    const names = BUILTIN_COMMANDS.map((c) => c.name)
    assert.equal(new Set(names).size, names.length)
  })

  it("includes help descriptions", () => {
    for (const cmd of BUILTIN_COMMANDS) {
      assert.ok(cmd.description.length > 0)
    }
  })
})

describe("executeCommand", () => {
  it("handles /help", async () => {
    const ctx = stubCtx()
    const result = await executeCommand("/help", ctx)
    assert.ok(result)
    assert.ok((ctx.openHelp as any).mock.calls.length > 0)
  })

  it("handles /clear", async () => {
    const ctx = stubCtx()
    const result = await executeCommand("/clear", ctx)
    assert.ok(result)
    assert.ok((ctx.setMessages as any).mock.calls.length > 0)
    assert.ok((ctx.setDraft as any).mock.calls.length > 0)
  })

  it("handles /new — creates a new session", async () => {
    const ctx = stubCtx()
    const result = await executeCommand("/new", ctx)
    assert.ok(result)
    assert.ok((ctx.createNewSession as any).mock.calls.length > 0)
  })

  describe("/mode", () => {
    it("switches to build mode", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/mode build", ctx)
      assert.ok(result)
      assert.ok((ctx.setMode as any).mock.calls.length > 0)
      assert.equal((ctx.setMode as any).mock.calls[0][0], "build")
    })

    it("switches to plan mode", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/mode plan", ctx)
      assert.ok(result)
      assert.equal((ctx.setMode as any).mock.calls[0][0], "plan")
    })

    it("switches to compose mode", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/mode compose", ctx)
      assert.ok(result)
      assert.equal((ctx.setMode as any).mock.calls[0][0], "compose")
    })

    it("toggles mode when no argument given", async () => {
      const ctx = stubCtx() // mode is "build"
      const result = await executeCommand("/mode", ctx)
      assert.ok(result)
      assert.ok((ctx.setMode as any).mock.calls.length > 0)
      assert.equal((ctx.setMode as any).mock.calls[0][0], "plan")
    })

    it("rejects invalid mode", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/mode invalid", ctx)
      assert.ok(result)
      assert.ok((ctx.setMode as any).mock.calls.length === 0)
    })
  })

  describe("/provider", () => {
    it("shows current provider without argument", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/provider", ctx)
      assert.ok(result)
    })

    it("switches provider with argument", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/provider opencode-zen", ctx)
      assert.ok(result)
      assert.ok((ctx.setCurrentProvider as any).mock.calls.length > 0)
    })

    it("opens provider list", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/provider list", ctx)
      assert.ok(result)
      assert.ok((ctx.openProviderList as any).mock.calls.length > 0)
    })
  })

  describe("/codex-login", () => {
    it("authorizes Codex", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/codex-login", ctx)
      assert.ok(result)
      assert.ok((ctx.codexLogin as any).mock.calls.length > 0)
      assert.equal((ctx.codexLogin as any).mock.calls[0][0], "browser")
    })

    it("authorizes Codex with callback code", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/codex-login code http://localhost:1455/auth/callback?code=abc", ctx)
      assert.ok(result)
      assert.equal((ctx.codexLogin as any).mock.calls[0][0], "code")
      assert.equal((ctx.codexLogin as any).mock.calls[0][1], "http://localhost:1455/auth/callback?code=abc")
    })
  })

  describe("/xai-login", () => {
    it("authorizes xAI", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/xai-login", ctx)
      assert.ok(result)
      assert.ok((ctx.xaiLogin as any).mock.calls.length > 0)
    })
  })

  describe("/model", () => {
    it("shows current model without argument", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/model", ctx)
      assert.ok(result)
    })

    it("switches model with argument", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/model gpt-4o", ctx)
      assert.ok(result)
      assert.ok((ctx.setCurrentModel as any).mock.calls.length > 0)
    })

    it("opens model list", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/model list", ctx)
      assert.ok(result)
      assert.ok((ctx.openModelList as any).mock.calls.length > 0)
    })
  })

  describe("/memory", () => {
    it("shows workspace memory status", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/memory", ctx)
      assert.ok(result)
      const calls = (ctx.showToast as any).mock.calls
      assert.ok(calls.length > 0)
      const first = calls[0]
      const args = first.arguments ?? first
      assert.equal(args[0], "info")
      assert.equal(args[1], "Prompt memory")
    })
  })

  describe("/sessions", () => {
    it("opens session list", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/sessions", ctx)
      assert.ok(result)
      assert.ok((ctx.openSessionList as any).mock.calls.length > 0)
    })

    it("handles /s alias", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/s", ctx)
      assert.ok(result)
      assert.ok((ctx.openSessionList as any).mock.calls.length > 0)
    })
  })

  describe("/queue", () => {
    it("opens queued messages viewer", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/queue", ctx)
      assert.ok(result)
      assert.ok((ctx.openQueuedMessages as any).mock.calls.length > 0)
    })

    it("handles /queued alias", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/queued", ctx)
      assert.ok(result)
      assert.ok((ctx.openQueuedMessages as any).mock.calls.length > 0)
    })
  })

  describe("/autopilot", () => {
    it("enables autopilot", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/autopilot on", ctx)
      assert.ok(result)
      assert.equal((ctx.setAutopilotMode as any).mock.calls[0][0], "standard")
      const args = (ctx.showToast as any).mock.calls[0].arguments ?? (ctx.showToast as any).mock.calls[0]
      assert.equal(args[0], "success")
      assert.equal(args[1], "Standard Autopilot enabled")
    })

    it("disables autopilot", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/autopilot off", ctx)
      assert.ok(result)
      assert.equal((ctx.setAutopilotMode as any).mock.calls[0][0], "off")
    })

    it("enables proactive mode", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/autopilot proactive", ctx)
      assert.ok(result)
      assert.equal((ctx.setAutopilotMode as any).mock.calls[0][0], "proactive")
      const args = (ctx.showToast as any).mock.calls[0].arguments ?? (ctx.showToast as any).mock.calls[0]
      assert.equal(args[1], "Proactive Autopilot enabled")
      assert.ok(args[2].includes("aligned with the existing plan"))
      assert.ok(args[2].includes("pause on uncertainty"))
    })

    it("shows status", async () => {
      const ctx = stubCtx({ getAutopilotMode: mock((): AutopilotMode => "proactive") })
      const result = await executeCommand("/autopilot", ctx)
      assert.ok(result)
      const args = (ctx.showToast as any).mock.calls[0].arguments ?? (ctx.showToast as any).mock.calls[0]
      assert.equal(args[0], "info")
      assert.equal(args[1], "Autopilot")
      assert.equal(args[2], "PROACTIVE")
    })

    it("rejects invalid options", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/autopilot 5m", ctx)
      assert.ok(result)
      assert.equal((ctx.setAutopilotMode as any).mock.calls.length, 0)
      const args = (ctx.showToast as any).mock.calls[0].arguments ?? (ctx.showToast as any).mock.calls[0]
      assert.equal(args[0], "error")
      assert.equal(args[1], "Invalid autopilot option")
    })

    it("does not accept the removed /autoloop command", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/autoloop on", ctx)
      assert.equal(result, false)
    })
  })

  describe("/compact", () => {
    it("runs session compaction", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/compact", ctx)
      assert.ok(result)
      assert.ok((ctx.compactSession as any).mock.calls.length > 0)
    })
  })

  describe("/exit", () => {
    it("calls exitApp", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/exit", ctx)
      assert.ok(result)
      assert.ok((ctx.exitApp as any).mock.calls.length > 0)
    })

    it("handles /quit alias", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/quit", ctx)
      assert.ok(result)
      assert.ok((ctx.exitApp as any).mock.calls.length > 0)
    })
  })

  it("shows toast for provider success", async () => {
    const ctx = stubCtx({ setCurrentProvider: mock(() => Promise.resolve({ ok: true, message: "Provider switched" })) })
    const result = await executeCommand("/provider openai", ctx)
    assert.ok(result)
    const calls = (ctx.showToast as any).mock.calls
    assert.equal(calls.length, 1)
    const args = calls[0].arguments ?? calls[0]
    assert.equal(args[0], "success")
    assert.equal(args[1], "Provider updated")
    assert.equal(args[2], "Provider switched")
  })

  it("shows toast for provider failure", async () => {
    const ctx = stubCtx({ setCurrentProvider: mock(() => Promise.resolve({ ok: false, message: "Unknown provider" })) })
    const result = await executeCommand("/provider nope", ctx)
    assert.ok(result)
    const calls = (ctx.showToast as any).mock.calls
    assert.equal(calls.length, 1)
    const args = calls[0].arguments ?? calls[0]
    assert.equal(args[0], "error")
    assert.equal(args[1], "Provider update failed")
    assert.equal(args[2], "Unknown provider")
  })

  it("shows toast for memory status", async () => {
    const ctx = stubCtx()
    const result = await executeCommand("/memory", ctx)
    assert.ok(result)
    assert.ok((ctx.showToast as any).mock.calls.length > 0)
    const call = (ctx.showToast as any).mock.calls[0]
    const args = call.arguments ?? call
    assert.equal(args[0], "info")
    assert.equal(args[1], "Prompt memory")
  })

  it("lists discovered skills", async () => {
    const ctx = stubCtx({
      skillDirs: () => [],
    })
    const result = await executeCommand("/skills", ctx)
    assert.ok(result)
    const args = (ctx.showToast as any).mock.calls[0].arguments ?? (ctx.showToast as any).mock.calls[0]
    assert.equal(args[0], "info")
    assert.equal(args[1], "Skills")
    assert.equal(args[2], "No skills found")
  })

  it("lists skills and displays an individual skill", async () => {
    const root = mkdtempSync(join(tmpdir(), "ozc-command-skills-"))
    const skillDir = join(root, "compose", "demo")
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, "SKILL.md"), "---\nname: compose:demo\ndescription: Demonstrate a workflow\n---\n# Demo\n\nFollow these steps.\n")
    const ctx = stubCtx({ skillDirs: () => [root] })

    assert.ok(await executeCommand("/skills", ctx))
    let args = (ctx.showToast as any).mock.calls[0].arguments ?? (ctx.showToast as any).mock.calls[0]
    assert.equal(args[1], "Skills (1)")
    assert.match(args[2], /compose:demo — Demonstrate a workflow/)

    assert.ok(await executeCommand("/skill compose:demo", ctx))
    args = (ctx.showToast as any).mock.calls[1].arguments ?? (ctx.showToast as any).mock.calls[1]
    assert.equal(args[1], "Skill: compose:demo")
    assert.match(args[2], /# Demo/)
  })

  it("shows usage when /skill has no name", async () => {
    const ctx = stubCtx()
    const result = await executeCommand("/skill", ctx)
    assert.ok(result)
    const args = (ctx.showToast as any).mock.calls[0].arguments ?? (ctx.showToast as any).mock.calls[0]
    assert.equal(args[0], "error")
    assert.equal(args[1], "Usage")
    assert.match(args[2], /\/skill <name>/)
  })

  it("returns false for unknown command", async () => {
    const ctx = stubCtx()
    const result = await executeCommand("/nonexistent", ctx)
    assert.ok(!result)
  })
})
