import { describe, it, mock } from "bun:test"
import assert from "node:assert"
import { BUILTIN_COMMANDS, executeCommand, type CommandContext } from "./commands"
import type { DisplayBlock } from "./tui"
import type { Message } from "../provider/types"

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
    messages: () => messages,
    setMessages: mock((fn: any) => {
      if (typeof fn === "function") fn(messages)
    }),
    setDraft: mock(() => {}),
    setNotices: mock((fn: any) => {
      if (typeof fn === "function") fn(notices)
      else notices.push(fn)
    }),
    exitApp: mock(() => Promise.resolve()),
    scrollBottom: mock(() => {}),
    switchSession: mock(() => {}),
    createNewSession: mock(() => {}),
    currentSessionId: mock(() => "ses_test123"),
    openSessionList: mock(() => {}),
    openProviderList: mock(() => {}),
    openModelList: mock(() => {}),
    openHelp: mock(() => {}),
    refreshSessions: mock(() => {}),
    codexLogin: mock(() => Promise.resolve({ ok: true, message: "authorized" })),
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
    assert.ok(names.includes("mode"))
    assert.ok(names.includes("model"))
    assert.ok(names.includes("sessions"))
    assert.ok(names.includes("tools"))
    assert.ok(names.includes("thinking"))
    assert.ok(names.includes("auto"))
    assert.ok(names.includes("commit"))
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

  it("handles /new (alias)", async () => {
    const ctx = stubCtx()
    const result = await executeCommand("/new", ctx)
    assert.ok(result)
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

  it("returns false for unknown command", async () => {
    const ctx = stubCtx()
    const result = await executeCommand("/nonexistent", ctx)
    assert.ok(!result)
  })
})
