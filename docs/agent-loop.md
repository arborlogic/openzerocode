# OpenZeroCode — Agent Loop

> **Status: ✅ Stable — describes the implemented streaming agent loop.**

This document explains how a single agent turn actually runs: how messages are
assembled, how the model is called step by step, how tool calls are executed,
and the safety/efficiency mechanisms built into the loop. The surrounding
subsystems (permissions, peers, memory, providers) have their own docs; this one
is about the *heart* of the agent.

Primary implementation: [`src/client/session-runner.ts`](../src/client/session-runner.ts)
(`streamSession`). A simpler, non-streaming variant lives in
[`src/core/run-loop.ts`](../src/core/run-loop.ts) — see [Two loops](#two-loops).

---

## Entry points

| Caller | Path | Notes |
|--------|------|-------|
| TUI | `runSession()` → `streamSession()` | Translates `StreamChunk`s into TUI callbacks; render path unchanged. |
| Serve / SDK | `streamSession()` directly | Consumes the `AsyncGenerator<StreamChunk>` (see `plan-serve-mode.md`). |
| Core / tests | `core/run-loop.ts` | Non-streaming, sequential, minimal. |

`streamSession()` is an **async generator**. It yields a `StreamChunk` for every
token, reasoning chunk, tool-call delta, tool result, status update, notice,
usage event, machine-readable terminal outcome, and the final `done`/`error`.
Its generator **return value** is the full message history produced this run.

---

## One turn, step by step

A "turn" is one user input. The loop runs up to `maxSteps` model round-trips
(default 50). Each iteration:

1. Emit `status: thinking (step N/max)`.
2. Call `provider.stream(...)` with the assembled messages + tool defs.
3. Accumulate the streamed assistant text, reasoning, and tool-call deltas.
4. If the model produced **no tool calls** → emit `done` and return (unless the
   stream was cut by a token limit; see [Continue-after-length](#continue-after-length)).
5. If the model **did** call tools → execute them, append the results, loop again.

Every run emits exactly one terminal outcome. If the loop reaches `maxSteps`
without the model finishing, it emits a
`step_limit_reached` outcome followed by a notice telling the user to type
`continue` or raise `OPENZEROCODE_MAX_STEPS`, rather than silently presenting
an unfinished run as complete.

---

## Message assembly

The list sent to the model is built as:

```
[ system ] [ compaction summary? ] [ trimmed history ] [ user message ]
```

- **System prompt** comes from `runtime.systemPrompt(mode)` (see
  `system-prompt.ts`). In **plan** mode the tool defs are emptied entirely, so
  Plan mode is a hard runtime restriction, not just a prompt instruction.
- **Compaction summary**, if present, is injected as a `[Compaction Summary]`
  system message (see `memory-architecture.md`).
- **History is trimmed by a sliding window**: only the most recent messages that
  fit within `contextLimit * 0.55` tokens are sent. The window also skips any
  leading orphaned `tool` messages so a tool-result is never sent without its
  originating assistant message.

### Prefix stabilization (cache-friendly)

Only the first step sends the full message list. Every subsequent step sends:

```
[ permanentPrefix ] + [ messages added during this turn ]
```

where `permanentPrefix = [system, compactionSummary?, userMessage]`. Keeping the
prefix byte-stable across steps lets upstream providers reuse their prompt cache
instead of re-reading the whole conversation each step.

---

## Tool execution

After the assistant message is parsed into tool calls, the loop walks the calls
in order and groups them into batches:

- **Read-only tools** (`read`, `grep`, `glob`, `web_fetch`) are batched and run
  **in parallel** with `Promise.all`.
- **Mutating tools** (`write`, `edit`, `bash`, `todowrite`, `browser_*`,
  `call_peer`, …) run **strictly one at a time, in the model's order**.

Permission prompts are **serialized** via `serializedAsk` even when the tool work
itself runs in parallel, so the UI only ever shows one approval dialog at a time.

Each tool runs through `def.execute(args, ctx)` with:

- a 5-minute timeout (`Effect.timeout(300_000)`) so a hung command can't lock the
  session forever;
- a `catchCause` net that converts any failure into a `Result{title:"Error"}`
  rather than crashing the turn.

Tool results are converted to text (`convertToolResult`, which truncates large
output) and appended as `tool` messages to both the request list and the result
history. An unknown tool name yields an error `tool` message so the model can
recover instead of stalling.

### Recurring tool failures

Tool failures are fingerprinted from the tool name and a normalized first line
of output (numbers, hex addresses, and whitespace do not create a new
fingerprint). If one fingerprint occurs at least three times in a run, tool
execution stops immediately with `replan_needed`; it does not spend the
remaining step budget retrying. Its `reason` and `recentErrors` name the recurring tool
failures so an automation controller can ask the agent to change approach rather
than blindly retrying the same command.

---

## Terminal outcomes

Before every terminal `done` or `error` condition, the production loop emits
exactly one `{ type: "outcome", outcome: RunOutcome }` chunk and calls the
optional `StreamOptions.onOutcome` callback. Consumers should use this
machine-readable contract for scheduling; notices remain human-facing context.

| Outcome | Meaning | Typical automated reaction |
|---|---|---|
| `completed` | The model ended normally. | Do not automatically re-consult Autopilot. |
| `step_limit_reached` | The run consumed its `maxSteps`. | Offer or schedule a bounded continuation. |
| `provider_error` | A request, stream, or invalid provider completion failed. | Retry, wait, or pause based on provider policy. |
| `tool_error` | A caller-specific policy terminated on one tool failure. | Repair or change the tool invocation. |
| `replan_needed` | A single tool-error fingerprint recurred three or more times. | Ask for a changed approach using `reason` / `recentErrors`. |
| `internal_error` | Unexpected application/runtime code failed outside provider handling. | Pause and surface the defect; do not retry as a provider failure. |
| `aborted` | The caller cancelled the run. | Stop; do not resume without a new instruction. |

`tool_error` is reserved for callers that choose to terminate on an individual
tool failure. The built-in loop normally gives the model the tool result and a
chance to recover, so it emits `replan_needed` only once errors become
repetitive.

Autopilot may consult its supervisor for step-limit, provider, tool, and replan
outcomes. It never starts a follow-up after `completed`, an explicit `aborted`,
or an `internal_error` outcome.

---

## Streaming & cancellation

- The provider stream is read chunk by chunk; `delta.content`,
  `delta.reasoning_content`, and `tool_calls` deltas each emit their own chunk
  type plus a `status` update.
- **Abort is wired directly into `reader.cancel()`**, not just checked at the top
  of the loop. If the user cancels while blocked inside `reader.read()`, the read
  unblocks immediately and the underlying `ReadableStream` tears down the source
  HTTP request — so a cancelled turn does not keep burning tokens in the
  background.
- Mid-stream read failures are re-thrown (not treated as EOF), so a turn never
  silently ends after a tool result with no final answer.

### Continue-after-length

If the model stops with `finish_reason === "length"` (hit its output token cap)
and produced no tool calls, the loop appends a system message instructing it to
"continue from exactly where it stopped" and runs another step, emitting a
`response hit token limit, continuing...` notice. This stitches a long answer
back together instead of truncating it.

### Rate-limit retry (opt-in)

When `OPENZEROCODE_RETRY_429=true`, a failed `stream()` call that looks like a
rate-limit error is retried on a `[2s, 5s, 10s]` backoff schedule, with a
`rate limited, retrying in Ns` notice. Disabled by default.

---

## Configuration

| Knob | Default | Effect |
|------|---------|--------|
| `maxSteps` option / `OPENZEROCODE_MAX_STEPS` | 50 | Max model round-trips per turn. |
| `OPENZEROCODE_RETRY_429` | off | Enable rate-limit backoff retries. |
| `reasoning_effort` | none | Passed only to models whose config marks `reasoning` support; silently dropped otherwise. |
| `workdir` option | `process.cwd()` | `cwd`/`root` handed to every tool's `Context`. |
| sliding-window budget | `contextLimit * 0.55` | Token budget for sent history. |

---

## Autonomous mode (autoloop)

[`src/client/autoloop.ts`](../src/client/autoloop.ts) layers an optional
supervisor on top of the loop: the human delegates the next *N* minutes/hours to
the agent. Between turns a supervisor prompt reviews the transcript and emits one
line of JSON:

```json
{"confidence":"high"|"low"|"pending","instruction":"<next step>","reason":"..."}
```

- **high** — proceed immediately (next step is unambiguous, safe, reversible,
  repo-local, goal not yet complete).
- **pending** — the last reply offered options *with* a clear recommendation;
  wait 3 minutes for a human, then proceed with the recommended action.
- **low** — stop and wait for a human (ambiguous, needs secrets/decisions,
  destructive/irreversible, or the goal looks already complete).

The conservative bias (anything risky → `low`) is intentional: the supervisor
only auto-continues safe, repo-local work.

---

## Two loops

There are two implementations of the loop and they have **diverged**:

| | `client/session-runner.ts` | `core/run-loop.ts` |
|---|---|---|
| Streaming | ✅ generator of `StreamChunk` | ❌ single non-streaming completion |
| Sliding-window history | ✅ | ❌ sends everything |
| Prefix stabilization | ✅ | ❌ |
| Parallel read-only tools | ✅ | ❌ sequential |
| Continue-after-length | ✅ | ❌ |
| Rate-limit retry | ✅ (opt-in) | ❌ |
| Tool timeout | ✅ 5 min | ❌ |

`session-runner.ts` is the production path used by the TUI and serve mode.
`core/run-loop.ts` is the minimal reference/test loop. **When changing turn
behavior, update `session-runner.ts`** — and be aware the core loop will not pick
up the change automatically.

---

## Related code & docs

- [`src/client/session-runner.ts`](../src/client/session-runner.ts) — the loop.
- [`src/client/system-prompt.ts`](../src/client/system-prompt.ts) — prompt assembly, Build/Plan modes.
- [`src/client/session-compact.ts`](../src/client/session-compact.ts) — compaction; see [memory-architecture.md](memory-architecture.md).
- [`src/tool/registry.ts`](../src/tool/registry.ts) — built-in tool set.
- [`src/permission/`](../src/permission/) — see [auto-approve-design.md](auto-approve-design.md).
- [peer-communication-design.md](peer-communication-design.md) — `call_peer` and multi-agent.
- [current-architecture-notes.md](current-architecture-notes.md) — overall stable architecture.
</content>
</invoke>
