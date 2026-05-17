# OpenZeroCode — Plugin Architecture & Strategic Direction

> **Status: ✏️ Draft — This document defines the target architecture and is actively evolving as implementation proceeds.**
>
> Last updated: 2025-05-17
>
> **Note:** zero-api client code (`src/plugin/zero-api.ts`) is kept on disk as reference
> but is NOT exported from the plugin barrel and NOT used in active code paths.
> It will be re-enabled when zerowapper integration requires it.

---

## Table of Contents

1. [Strategic Context](#1-strategic-context)
2. [Product Three-Layer Architecture](#2-product-three-layer-architecture)
3. [Plugin System Design](#3-plugin-system-design)
4. [Correction Learning Loop (Primary Workflow)](#4-correction-learning-loop-primary-workflow)
5. [Memory Plugin](#5-memory-plugin)
6. [macOS Accessibility Plugin (Side Quest)](#6-macos-accessibility-plugin-side-quest)
7. [zero-api Relationship](#7-zero-api-relationship)
8. [Implementation Roadmap](#8-implementation-roadmap)
9. [Appendix: Corrections from opencode](#appendix-corrections-from-opencode)

---

## 1. Strategic Context

### Core Thesis

> OpenZeroCode is not "just" an AI coding assistant.
> It is an **AI runtime that learns from human corrections.**

This is the differentiating narrative. Coding assistants are everywhere (Cursor, Windsurf, Copilot). Computer-use agents are being raced toward by large vendors (OpenAI, Google, Claude). But a **correction learning loop** — where AI observes real data flows, understands how humans fix its outputs, and沉淀 reusable procedures — is not yet a product category.

### Existing Beachhead

旅拍立記 (TripReceipts) provides a real, non-synthetic scenario:

```
Raw OCR / LLM parsing result
        ↓
Human-corrected receipt data (merchant, amount, date, items)
        ↓
Correction loop captures:
  - What was wrong?
  - How was it fixed?
  - Does this pattern repeat?
  - Can we turn this into a procedure?
```

This is not a hypothetical use case — it is already happening daily.

### What This Is Not

- Not a general-purpose browser automation tool
- Not a coding assistant that happens to have memory
- Not a monitoring/dashboard product

It is a **correction learning runtime** with openzerocode as the operator interface, plugins as the capability layer, and zero-api as the backend.

---

## 2. Product Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  openzerocode（Operator Interface + Runtime）                │
│                                                             │
│  Role: The terminal UI where engineers observe, analyze,     │
│        correct, and generate procedures.                    │
│                                                             │
│  Core: TUI (terminal UI), session management, tool system,  │
│        provider abstraction, plugin runtime.                │
│                                                             │
│  Invariant: OpenZeroCode must remain fully functional       │
│             without zero-api and without any plugin loaded. │
├─────────────────────────────────────────────────────────────┤
│  Plugins（Capability Layer）                                  │
│                                                             │
│  Role: Optional extensions loaded at startup. Each plugin   │
│        can register slash commands, inject system prompt    │
│        fragments, hook into request/response lifecycle,     │
│        and provide new tools.                               │
│                                                             │
│  Built-in plugin candidates:                                │
│    • memory       — cross-session memory (file-based first) │
│    • correction   — correction learning loop (primary)      │
│                                                             │
│  Experimental plugin candidates:                             │
│    • macos-bridge — Apple Accessibility operations          │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  zero-api（Backend / Memory / Procedure Storage）            │
│                                                             │
│  Role: Persistent storage for trace data, memory entries,   │
│        procedures, evaluation results. Not required for     │
│        openzerocode core operation.                         │
│                                                             │
│  Components: SQLite (FTS5), memory CRUD, context builder,   │
│              correction feedback, procedure store.          │
└─────────────────────────────────────────────────────────────┘
```

### Layer Dependency Rules

| From | To | Dependency |
|------|----|------------|
| openzerocode | Plugins | Optional: plugins are loaded at startup if configured |
| openzerocode | zero-api | None: zero-api is a plugin backend, not a core dependency |
| Plugins | zero-api | Optional: some plugins may use zero-api as a remote backend |
| Plugins | openzerocode core API | Yes: plugins consume the plugin API |

---

## 3. Plugin System Design

### 3.1 Core Interface

```typescript
// src/plugin/types.ts

export type Plugin = {
  id: string
  name: string
  version?: string

  /** Slash commands registered by this plugin */
  commands?: PluginCommand[]

  /** Fragment injected into the system prompt */
  systemPrompt?: () => string | undefined

  /** Called before each LLM request — can inject context or modify input */
  beforeRequest?: (
    input: string,
    history: Message[],
  ) => Promise<{ input?: string; extraMessages?: Message[] }>

  /** Called after each LLM response — can store corrections, update memory */
  afterResponse?: (
    input: string,
    response: Message,
    history: Message[],
  ) => Promise<void>
}

export type PluginCommand = {
  name: string
  description: string
  args?: string
  execute(args: string, ctx: PluginCommandContext): Promise<string | void>
}

export type PluginCommandContext = {
  notices: (text: string, kind?: "system" | "error") => void
  messages: () => Message[]
  setMessages: (msgs: Message[]) => void
}
```

### 3.2 Design Rationale

| Decision | Why |
|----------|-----|
| Static object, not factory function | Simpler to register, easier to type-check, no closure confusion. opencode uses async factories because plugins may need async setup; we can add that later if needed |
| `commands` array, not keymap | openzerocode's command dispatch is simpler than opencode's keymap system. No need for keybinding layers, command categories, or priority sorting |
| `systemPrompt()` method, not hook | opencode uses `experimental.chat.system.transform` hook with a `(input, output) => void` pattern. We simplify to a getter that returns a string fragment |
| `beforeRequest` / `afterResponse` lifecycle | Covers the two most useful interception points without the 15+ hook types opencode defines |
| No `server` vs `tui` split | openzerocode is a single TUI process. There is no server-side plugin to separate |

### 3.3 Registry

```typescript
// src/plugin/registry.ts

class PluginRegistry {
  private plugins = new Map<string, Plugin>()

  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.id)) {
      console.warn(`Plugin "${plugin.id}" already registered, skipping`)
      return
    }
    this.plugins.set(plugin.id, plugin)
  }

  get(id: string): Plugin | undefined
  list(): Plugin[]
  collectSystemPrompts(): string[]
  findCommand(name: string): { plugin: Plugin; command: PluginCommand } | undefined
}
```

### 3.4 Integration Points

#### Command Dispatch (`src/client/commands.ts`)

Currently a monolithic switch statement. Target flow:

```
executeCommand(input)
  ├── 1. Try builtin commands (current switch logic, unchanged)
  ├── 2. Try plugin commands (iterate registered plugins, match by name)
  └── 3. If no match, return false (unchanged)
```

#### System Prompt Assembly (`src/client/system-prompt.ts`)

Currently builds from BASE + mode reminder + AGENTS.md. Target:

```
buildSystemPrompt(mode, agentsInstruction)
  ├── BASE_SYSTEM_PROMPT
  ├── mode reminder (build / plan)
  ├── AGENTS.md content (if present)
  └── plugin system prompt fragments (collected from all registered plugins)
```

#### Lifecycle Hooks (`src/client/tui.tsx`)

The `beforeRequest` and `afterResponse` hooks need integration points in the session runner / message submission flow. These are additive — if no plugin is registered, the hooks are no-ops.

### 3.5 Comparison with opencode Plugin System

| Aspect | opencode | OpenZeroCode (ours) |
|--------|----------|---------------------|
| Plugin shape | Async factory `(input, options) => Promise<Hooks>` | Static `Plugin` object |
| Hook dispatch | Named hooks with `(input, output) => void` signature | Direct method calls |
| Command registration | Keymap layers (`api.keymap.registerLayer`) | `commands: PluginCommand[]` array |
| TUI extension | Slot system (JSX injection points) | Not in v1 (too early) |
| Plugin sources | npm packages + local file paths | Local only (file paths, v1) |
| Lifecycle hooks | 15+ named hooks | 3 hooks (command, before, after) |
| Version compatibility | semver check via `package.json.engines.opencode` | Not in v1 |
| Auth/provider hooks | Extensive auth/provider system | Not needed (single provider abstraction) |

We deliberately start simpler. Complexity can be added when use cases demand it.

---

## 4. Correction Learning Loop (Primary Workflow)

### 4.1 Concept

The correction learning loop is the killer workflow that justifies the entire architecture. It is **not a monitoring tool** — it is a continuous improvement cycle:

```
Raw Data (OCR / LLM parse)
        ↓
Human Correction (via app UI or direct edit)
        ↓
Correction Plugin detects diff
        ↓
AI analyzes correction → categorizes error type
        ↓
Pattern detection → repeated errors flagged
        ↓
Procedure generation → "next time do X instead"
        ↓
(Optional) Procedure applied → error rate measured
```

### 4.2 Core Data Types

```typescript
// plugins/correction/types.ts

/** A single observed correction: what changed and why */
export type CorrectionEvent = {
  id: string
  source: string                    // "receipt" | "order" | "crm" | "manual_review"
  entityId: string                  // which record was corrected
  field: string                     // which field was changed (e.g., "merchant", "total_amount")
  beforeValue: unknown
  afterValue: unknown
  rawContext?: string               // the original LLM output that led to the error
  correctedBy: "human" | "system"
  correctedAt: string               // ISO 8601
  tags?: string[]
}

/** AI analysis of a single correction event */
export type CorrectionAnalysis = {
  eventId: string
  category: CorrectionCategory
  reason: string                    // Why the AI thinks this correction was made
  confidence: number                // 0–1
  repeatCount?: number              // How many times this pattern has been observed
  procedureSuggestion?: string      // Natural language procedure
}

export type CorrectionCategory =
  | "normalization"     // e.g., セブンイレブン → 7-Eleven (same entity, different format)
  | "ocr_error"         // e.g., "O" → "0" misread
  | "misclassification" // e.g., tax field mapped to total field
  | "formatting"        // e.g., date format, number format
  | "missing_field"     // AI omitted a required field
  | "other"

/** A reusable correction procedure */
export type Procedure = {
  id: string
  title: string
  description: string
  scope: string[]                   // Which fields/situations this applies to
  condition: string                 // When to apply this procedure
  action: string                    // What to do
  evidence: number                  // Number of correction events supporting this
  accuracy: number                  // Estimated accuracy when applied
  createdAt: string
  updatedAt: string
}
```

### 4.3 MVP Scope (4-Week Validation Sprint)

The MVP should be narrow enough to ship quickly but complete enough to validate the thesis.

#### Week 1: Correction Event Schema + Storage

- Define `CorrectionEvent` type
- Implement file-based store (`~/.openzerocode/corrections/events.jsonl`)
- Implement `/correction list` command

#### Week 2: Diff Scanner

- Implement source-specific scanner for one real data source (旅拍立記's receipt data)
- Detect changes between raw and corrected records
- Produce `CorrectionEvent[]`
- Implement `/correction scan` command

#### Week 3: Correction Analyzer

- Send correction events to LLM for categorization
- Implement `CorrectionAnalysis` generation
- Implement `/correction analyze` command
- Output structured analysis per event

#### Week 4: Procedure Suggestion

- Aggregate repeated correction patterns
- Generate procedure suggestions using LLM
- Implement `/correction suggest` command
- Output report like:

```
Procedure Suggestion #12

Problem:
Japanese receipt total amount is often confused with tax-included label.

Observed evidence:
- 23 corrections in last 7 days
- 18 corrections changed tax_amount → total_amount
- Common tokens: 合計, 税込, お預り

Suggested procedure:
When parsing Japanese receipts, if a number appears next to 合計 or お買上計,
prefer mapping it to total_amount.

Impact:
May reduce amount-field corrections by around 30–40%.
```

### 4.4 Why This Is the Primary Workflow

| Factor | Assessment |
|--------|------------|
| Differentiation | Low competition. No major vendor is focused on correction learning |
| Real data available | 旅拍立記 has ongoing human corrections |
| Clear value metric | "Before: 35% correction rate → After: 22% correction rate" |
| Feasibility | Narrow scope (receipt parsing) makes MVP achievable |
| Growth path | Extends naturally to other data sources, other domains |
| Business viability | Enterprises pay for "reducing manual correction effort" |

---

## 5. Memory Plugin

### 5.1 Purpose

Provide cross-session persistent memory without requiring zero-api. This is the **pragmatic entry point** for the plugin system — it has clear user value and zero external dependencies.

### 5.2 Design

```typescript
// plugins/memory/types.ts

export type MemoryEntry = {
  id: string
  title: string
  content: string
  type: "knowledge" | "procedure" | "correction" | "daily"
  tags: string[]
  createdAt: string
  updatedAt: string
}
```

### 5.3 Storage (v1)

**JSON file** at `~/.openzerocode/memory.json`.

Simple, zero dependencies, easy to inspect. Search is linear scan with keyword matching.

### 5.4 Commands

| Command | Description |
|---------|-------------|
| `/memory search <query>` | Search memories by keyword |
| `/memory write <title> | <content>` | Write a new memory entry |
| `/memory list [type]` | List recent memories, optionally filtered by type |

### 5.5 Integration

The memory plugin uses `systemPrompt()` to inject a summary of recent relevant memories into the system prompt, and `beforeRequest` to append relevant memory context to the LLM request.

### 5.6 Future Upgrade Path

```
v1: JSON file (keyword search)
  ↓
v2: SQLite + FTS5 (full-text search, same process)
  ↓
v3: zero-api remote backend (optional, for shared/cross-machine memory)
```

Each upgrade should be invisible to the plugin consumer — only the store implementation changes.

---

## 6. macOS Accessibility Plugin (Side Quest)

### 6.1 Status

> **⏸️ Deferred — allocated ~10% exploration bandwidth.**

Not the primary workflow, but preserved as a demonstration of plugin system flexibility and a potential future capability.

### 6.2 Concept

```
openzerocode
    │
    └── plugin: macos-bridge
           │
           ├── Local mode → osascript / JXA / Accessibility API
           └── Remote mode (future) → SSH → remote Mac
```

### 6.3 Tool Candidates

```typescript
// Tentative tool definitions — not implementing yet

"macos-list-apps"      → List running applications
"macos-ui-tree"        → Get Accessibility UI element tree for an app
"macos-click"          → Click a UI element by path
"macos-type"           → Type text into focused element
"macos-screenshot"     → Capture screen (with optional OCR)
"macos-applescript"    → Execute arbitrary AppleScript
```

### 6.4 Why Deferred

| Factor | Assessment |
|--------|------------|
| Competition | Heavy: all major AI vendors are building computer-use agents |
| Differentiation | Low: "AI that can click buttons" is becoming a commodity |
| Complexity | High: Accessibility API is fragile, app-specific, error-prone |
| Integration value | Medium: useful for demos, but not for daily correction workflow |
| Strategic fit | Low: does not advance the "learning from corrections" thesis |

### 6.5 When to Revisit

- After correction learning loop is validated (post Week 4)
- If there is a specific user request for macOS automation
- As a weekend exploration to test plugin system extensibility

---

## 7. zero-api Relationship

> **Current status:** zero-api client code (`src/plugin/zero-api.ts`) is retained on disk
> as reference material. It is NOT exported from the plugin barrel and NOT used in
> any active code path. Re-integration will happen when zerowapper needs it.

### 7.1 Roles (Deferred)

| Component | Role in Correction Learning | Status |
|-----------|---------------------------|--------|
| zero-api | Persistent backend for trace, memory, procedure, evaluation | ⏸️ Deferred |
| openzerocode | Operator interface: observe, analyze, generate procedures | Active |
| zerowapper | Workflow app builder & operator (uses openzerocode as engine) | Scaffold |

### 7.2 Integration Options (Deferred)

| Option | When to Choose |
|--------|---------------|
| File-based (JSON) | v1 of every plugin — zero dependencies, works offline |
| SQLite (better-sqlite3) | When search performance matters but single-machine is fine |
| zero-api remote (HTTP) | When sharing across machines or needing higher durability |

File-based first, upgrade on demand. No lock-in. zero-api is not part of v1.

---

## 8. Implementation Roadmap

### Phase 0: Plugin System Foundation (Now)

```
Files to create:
  src/plugin/types.ts          — Plugin, PluginCommand, PluginCommandContext
  src/plugin/registry.ts       — PluginRegistry class
  src/plugin/index.ts          — Barrel export

Files to modify:
  src/client/commands.ts       — Add plugin command dispatch after builtins
  src/client/system-prompt.ts  — Collect plugin system prompt fragments

Validation:
  src/plugins/echo/index.ts    — Minimal plugin for testing
  └── /echo hello → prints "hello"
```

Deliverable: Plugin system works end-to-end with at least one plugin.

### Phase 1: Memory Plugin (Week 1–2)

```
Files to create:
  src/plugins/memory/types.ts   — MemoryEntry type
  src/plugins/memory/store.ts   — JSON file store
  src/plugins/memory/index.ts   — Plugin registration + commands

Commands:
  /memory write title | content
  /memory search query
  /memory list [type]
```

Deliverable: Cross-session memory that persists across restarts.

### Phase 2: Correction Learning Loop (Week 3–6)

```
Week 3: Schema + Store
  plugins/correction/types.ts
  plugins/correction/store.ts         — JSONL event log
  plugins/correction/index.ts         — Plugin registration
  /correction list

Week 4: Diff Scanner
  plugins/correction/scanner.ts       — Source-specific diff detection
  plugins/correction/sources/receipt.ts  — 旅拍立記 data source
  /correction scan

Week 5: Correction Analyzer
  plugins/correction/analyzer.ts      — LLM-based analysis
  /correction analyze

Week 6: Procedure Suggestion
  plugins/correction/suggester.ts     — Pattern aggregation + procedure generation
  /correction suggest
```

Deliverable: End-to-end correction learning loop with at least one real data source.

### Phase 3: macOS Accessibility (Exploration)

No fixed timeline. Allocated ~10% bandwidth after Phase 2.

---

## 9. Resource Allocation Guide

```
Phase 0: 20% — Plugin runtime infrastructure
Phase 1: 10% — Memory plugin (quick win)
Phase 2: 70% — Correction learning loop (primary)
Phase 3: 10% — macOS exploration (side quest)
```

This split ensures:
- The foundation (plugin system) gets built first
- The primary workflow (correction learning) gets the bulk of the resources
- The speculative feature (macOS bridge) is explored but not over-invested
- openzerocode's existing coding assistant capabilities are maintained throughout

---

## Appendix: Corrections from opencode

Key architectural differences between opencode's plugin system and ours, and why each divergence exists:

### What We Kept

| Concept | opencode | Ours |
|---------|----------|------|
| Plugin = collection of hooks | `Hooks` interface | `Plugin` type with method properties |
| Registry pattern | `PluginLoader` + `Plugin.Service` | `PluginRegistry` class |
| Lifecycle hooks for LLM interaction | `chat.message`, `chat.params` | `beforeRequest`, `afterResponse` |
| Commands via plugin | `api.keymap.registerLayer` | `commands: PluginCommand[]` |

### What We Simplified

| Concept | opencode | Ours | Reason |
|---------|----------|------|--------|
| Plugin creation | Async factory `(input, options) => Hooks` | Static `Plugin` object | No async setup needed yet |
| Hook dispatch | Named hooks with `(input, output) => void` | Direct method calls | Simpler, fewer edge cases |
| TUI extension | Slot system, JSX injection | Not in v1 | Adds complexity without immediate use case |
| Plugin resolution | npm + file paths, semver check | Local file paths only | npm resolution is premature |

### What We Skipped Entirely

| Feature | Why Skipped |
|---------|-------------|
| Auth/provider hooks | openzerocode has a single provider model, no multi-auth needs |
| Server/tui split | Single-process TUI only |
| Effect/Layer architecture | openzerocode uses a lighter functional approach |
| Theme system | Not relevant to plugin extensibility |
| Keymap/keybinding layers | Command dispatch is simpler in openzerocode |

---

## Document Version History

| Date | Change |
|------|--------|
| 2025-05-17 | Initial draft: plugin architecture, correction learning loop, roadmap |
