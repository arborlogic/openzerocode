import { describe, it, mock } from "node:test"
import assert from "node:assert"
import { BUILTIN_COMMANDS, executeCommand, type CommandContext } from "./commands"
import type { DisplayBlock } from "./tui"
import type { Message } from "../provider/types"

function stubCtx(overrides?: Partial<CommandContext>): CommandContext {
  const notices: DisplayBlock[] = []
  const messages: Message[] = []
  return {
    currentProvider: "openrouter",
    setCurrentProvider: mock.fn(() => Promise.resolve({ ok: true, message: "switched" })),
    currentProviderKeyName: mock.fn(() => "my-key"),
    listProviderKeys: mock.fn(() => ["my-key", "other-key"]),
    getProviderKeyConfigPath: mock.fn(() => "/tmp/providers.json"),
    setProviderKey: mock.fn(() => Promise.resolve({ ok: true, message: "key set" })),
    currentModel: "openrouter/auto",
    setCurrentModel: mock.fn(() => Promise.resolve({ ok: true, message: "model set" })),
    mode: "build" as const,
    setMode: mock.fn(),
    messages: () => messages,
    setMessages: mock.fn((fn: any) => {
      if (typeof fn === "function") fn(messages)
    }),
    setDraft: mock.fn(),
    setNotices: mock.fn((fn: any) => {
      if (typeof fn === "function") fn(notices)
      else notices.push(fn)
    }),
    exitApp: mock.fn(() => Promise.resolve()),
    scrollBottom: mock.fn(),
    switchSession: mock.fn(),
    createNewSession: mock.fn(),
    currentSessionId: mock.fn(() => "ses_test123"),
    openSessionList: mock.fn(),
    openProviderList: mock.fn(),
    openModelList: mock.fn(),
    refreshSessions: mock.fn(),
    ...overrides,
  }
}

describe("BUILTIN_COMMANDS", () => {
  it("includes expected commands", () => {
    const names = BUILTIN_COMMANDS.map((c) => c.name)
    assert.ok(names.includes("help"))
    assert.ok(names.includes("clear"))
    assert.ok(names.includes("info"))
    assert.ok(names.includes("provider"))
    assert.ok(names.includes("model"))
    assert.ok(names.includes("mode"))
    assert.ok(names.includes("sessions"))
    assert.ok(names.includes("session"))
    assert.ok(names.includes("tools"))
    assert.ok(names.includes("thinking"))
    assert.ok(names.includes("auto"))
    assert.ok(names.includes("commit"))
    assert.ok(names.includes("exit"))
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
    assert.ok((ctx.setNotices as any).mock.calls.length > 0)
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

  it("handles /info", async () => {
    const ctx = stubCtx()
    const result = await executeCommand("/info", ctx)
    assert.ok(result)
  })

  describe("/mode", () => {
    it("switches to build mode", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/mode build", ctx)
      assert.ok(result)
      assert.ok((ctx.setMode as any).mock.calls.length > 0)
      const call = (ctx.setMode as any).mock.calls[0]
      assert.equal(call.arguments[0], "build")
    })

    it("switches to plan mode", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/mode plan", ctx)
      assert.ok(result)
      assert.equal((ctx.setMode as any).mock.calls[0].arguments[0], "plan")
    })

    it("shows current mode when no argument", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/mode", ctx)
      assert.ok(result)
      assert.ok((ctx.setMode as any).mock.calls.length === 0)
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

  describe("/session", () => {
    it("creates new session", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/session new", ctx)
      assert.ok(result)
      assert.ok((ctx.createNewSession as any).mock.calls.length > 0)
    })

    it("opens a session", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/session open ses_abc", ctx)
      assert.ok(result)
      assert.ok((ctx.switchSession as any).mock.calls.length > 0)
      assert.equal((ctx.switchSession as any).mock.calls[0].arguments[0], "ses_abc")
    })

    it("shows usage for invalid subcommand", async () => {
      const ctx = stubCtx()
      const result = await executeCommand("/session", ctx)
      assert.ok(result)
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
