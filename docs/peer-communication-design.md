# Peer Communication Design

> **Status: ✅ Implemented — This is a design record, not a TODO list.**

This document records the design decisions for the peer-to-peer AI agent communication feature, which allows multiple named OpenZeroCode instances to delegate tasks to each other and exchange results.

---

## Motivation

When developing across two related projects simultaneously (e.g., an application and its companion desktop client), changes in one codebase often require coordinated changes in the other. Previously, the developer had to:

1. Manually switch terminals
2. Re-explain context to the second AI instance
3. Copy-paste results back

The peer communication feature lets the two AI agents communicate directly. Agent A can delegate a task to Agent B, and Agent B can call back with results — enabling a self-healing, bidirectional collaboration loop without the developer acting as a relay.

---

## Core Design Principle

> **Remote calls replace the user's keyboard input in the callee's TUI.**

A peer call is not a background job or a separate API call. It enters the callee's existing input queue exactly as if the user had typed the message. Everything downstream — tool execution, permission rules, model selection, ESC to abort — behaves identically to normal user input. No special casing is needed.

---

## Architecture

### Components

```
~/.openzerocode/peers.json          ← shared registry file
src/peer/registry.ts                ← read/write registry, liveness check
src/peer/server.ts                  ← lightweight HTTP server (per named instance)
src/peer/context.ts                 ← runtime state: selfName, currentHop, bounded collaboration budget
src/tool/call-peer.ts               ← call_peer tool (AI-callable)
src/client/tui.tsx                  ← --name parsing, wiring, display
src/client/commands.ts              ← /peers, /call slash commands
src/client/turn-entry.tsx           ← peer message visual styling
```

### Registry File

Each named instance registers itself in `~/.openzerocode/peers.json` on startup and removes itself on exit:

```json
[
  {
    "name": "myapp",
    "port": 49821,
    "pid": 12345,
    "startTime": 1718000000000,
    "workdir": "/Users/masato/Dev/myapp",
    "token": "xk9f2z..."
  }
]
```

Stale entries (dead PIDs) are filtered out on every read. No daemon or cleanup process is required.

---

## Startup Flow

```
openzerocode --name myapp
    │
    ├─ Generate random token
    ├─ Start HTTP server on port 0 → OS assigns free port
    ├─ Register { name, port, pid, startTime, workdir, token } in peers.json
    │     ├─ Reject if name already taken by a live process
    │     └─ Reject if workdir already registered (prevents editing same files)
    ├─ Wire _peerEnqueueFn → inputQueue.enqueue
    └─ Register SIGINT / SIGTERM / exit handlers → unregister on shutdown
```

Without `--name`, zero peer-related code runs. The existing behaviour is completely unaffected.

---

## Communication Flow

### Human-initiated call (`/call`)

```
Terminal A (myapp)                     Terminal B (geass)
─────────────────                      ──────────────────
/call geass <prompt>
    │
    ├─ Look up geass in peers.json
    ├─ POST /prompt { text, from: "myapp", hop: 0 }
    │   with x-peer-token header
    │                                  ← HTTP server receives request
    │                                  ← inputQueue.enqueue(encoded)
    │                                  ← runQueuedPrompt decodes origin + hop
    │                                  ← system prompt injected with callback instruction
    │                                  ← AI runs in geass's TUI
    │                                  ← displayed with orange border + "from: myapp"
    └─ Toast: "Calling geass…"
```

### AI-initiated callback (`call_peer` tool)

After geass's AI completes its task, it calls back via the `call_peer` tool:

```
Terminal B (geass) — AI run
    │
    ├─ call_peer("myapp", "Done. Updated UserPayload.id to string. ...")
    │   │
    │   ├─ Check selfName is set (peer mode active)
    │   ├─ Check collaboration budget (shallow hops or bounded deep budget)
    │   ├─ Look up myapp in peers.json
    │   ├─ ctx.ask → TUI permission prompt: "→ myapp: Done. Updated..."
    │   └─ POST /prompt { text, from: "geass", hop: 1 }
    │                                  Terminal A (myapp)
    │                                  ← inputQueue.enqueue(encoded)
    │                                  ← displayed with orange border + "from: geass"
    │                                  ← AI continues with the new context
```

---

## Collaboration Bounds

OpenZeroCode supports two peer-collaboration budget modes.

### Shallow hop guard (default)

Calls carry a `hop` counter that increments at each crossing:

| Source | hop value |
|--------|-----------|
| Human `/call` | 0 |
| First AI callback | 1 |
| Second AI callback | 2 |
| Third AI callback | 3 = MAX_HOP_DEPTH → rejected |

`MAX_HOP_DEPTH = 3` is defined in `src/peer/context.ts`. When the limit is reached, `call_peer` returns an error to the AI explaining why, and the chain stops. The AI can inform the user instead of silently failing.

This remains the default because it is conservative and prevents accidental agent ping-pong.

### Bounded deep collaboration mode

For more useful multi-agent workflows, start each participating instance with:

```sh
openzerocode --name myapp --deep-collaboration
```

In this mode, OpenZeroCode stops using depth as the primary bound and instead carries a total remaining peer-call budget through the chain:

- Default total budget: `12` non-one-way peer calls per chain
- CLI override: `--deep-collaboration-peer-calls N`
- Env override: `OPENZEROCODE_DEEP_COLLABORATION_PEER_CALLS=N`
- Mode env flag: `OPENZEROCODE_DEEP_COLLABORATION=1`
- `oneWay=true`, `intent=notify`, and `intent=handoff_summary` do not consume budget
- The same-pair roundtrip guard still applies to prevent unproductive two-agent loops

Each peer request also receives a `[Bounded Deep Collaboration]` system prompt. The prompt asks the callee to use phase labels (`[question]`, `[plan-review]`, `[work-result]`, `[critique]`, `[final-summary]`), avoid vague status bounces, and converge to a final summary when budget is low.

---

## Security

### Token authentication

Each registered peer holds a randomly generated token. Every `POST /prompt` request must include `x-peer-token: <token>` matching the registry entry. Requests with the wrong token receive `401 Unauthorized`.

The token is only stored on the local filesystem (`~/.openzerocode/peers.json`, user-owned) and transmitted over localhost. It is not intended to be cryptographically strong — it is a same-machine trust mechanism, not a network security boundary.

### Workdir isolation

Two peers cannot share the same working directory. The registry rejects registration if a live peer already claims the same real path (symlinks resolved). This prevents two AI agents from concurrently editing the same files.

### Permission rules

`call_peer` goes through the existing `ctx.ask` permission mechanism, identical to `bash` or `write`. The TUI shows:

```
Allow call_peer?
→ geass: Please update UserPayload.id to string
[y] yes  [a] always  [n] no
```

The user retains full control. Auto-approve rules apply to `call_peer` the same way they apply to other tools.

---

## Visual Design

Peer-originated messages use a distinct visual style to distinguish them from user-typed messages:

- **Border colour**: orange (`#f0883e`) instead of the normal green (`#7ee787`)
- **Label**: `from: <peer-name>` shown above the message text
- **Persistence**: the `origin` field is stored on the `Message` object and survives session save/reload, so the styling is preserved when switching sessions

The `origin` field is stripped from messages before they are sent to the LLM API (in `sanitizeMessages`), so it never reaches the model.

---

## Callback Instruction Injection

When a run is triggered by a peer request in shallow mode, the system prompt is extended with:

```
[Peer Request]
This task was sent by peer process "<name>". After completing the task, use the
call_peer tool to send a concise summary of what you did and any relevant results
back to "<name>". If the task cannot be completed or requires clarification,
call_peer back with that information instead.
```

This ensures the callee AI always knows:
1. The task originated from another agent
2. It is expected to report back
3. The caller's name (for the `call_peer` invocation)

The instruction is in the system prompt, not the user message, so it is invisible in the TUI.

In bounded deep collaboration mode, the injected prompt also includes the remaining peer-call budget and phase guidance so the agents can collaborate for longer without becoming unbounded.

---

## Slash Commands

| Command | Behaviour |
|---------|-----------|
| `/peers` | Lists all currently online named peers (name + workdir) |
| `/call <name> <prompt>` | Sends a prompt to the named peer from the current TUI |

Both commands are no-ops (with an informational message) when the current instance was not started with `--name`.

---

## Input Queue Integration

Peer prompts enter via `inputQueue.enqueue`, the same queue used for human keyboard input. This means:

- **Concurrency**: if the callee TUI is already processing a prompt, the peer call queues behind it and runs when the current run finishes
- **ESC**: pressing ESC aborts the peer-originated run identically to aborting a user-typed run
- **Sequential safety**: because the queue is FIFO and single-threaded, there is no risk of two runs editing files simultaneously within the same process

---

## Encoding Format

Peer origin is passed through the input queue as a prefixed string to avoid changing the `QueueItem` interface:

```
\x01peer:<fromName>:<hop>\x01<original text>
```

- `\x01` (ASCII SOH) is used as a delimiter because it never appears in normal user input
- `decodePeerInput` extracts the origin and hop; if no prefix is found, the input passes through unchanged
- The decoded `text` is what the AI sees and what is stored in session history

---

## Design Decisions

### Why a shared file instead of a daemon?

A daemon would require a separate process to always be running, adding startup complexity and failure modes. A shared file with PID-based liveness checks achieves the same discovery with zero additional infrastructure. Stale entries are cleaned up lazily on the next read.

### Why inject into system prompt instead of user message?

The user message is visible in the TUI. Injecting a call-back instruction into the user message would either show machine-readable noise to the human, or require stripping it from the display — adding complexity. The system prompt is the right place for operational instructions to the AI that are not part of the conversation content.

### Why not stream the response back to the caller automatically?

The callee AI deciding *what* to report back is the feature, not a workaround. Automatically forwarding the full assistant response would:
- Send noise (tool call details, reasoning steps) the caller doesn't need
- Remove the callee's agency to summarise, reframe, or decline
- Make the system harder to reason about (automatic side effects)

The `call_peer` tool gives the AI explicit control over what crosses the process boundary.

### Peer Collaboration Budget

Peer collaboration uses a conservative hop budget by default, but the user can
explicitly opt in to bounded deep collaboration when the task needs multi-agent
planning, product discussion, or architecture review.

Implemented controls:

- Default shallow max peer hop depth remains **3**.
- Users can override the shallow hop budget with `--max-peer-hops <N>` or
  `OPENZEROCODE_MAX_PEER_HOPS=<N>`.
- Users can enable bounded deep collaboration with `--deep-collaboration` or
  `OPENZEROCODE_DEEP_COLLABORATION=1`.
- Deep collaboration uses a carried total non-one-way peer-call budget instead
  of hop depth. The default is **12**, overrideable with
  `--deep-collaboration-peer-calls <N>` or
  `OPENZEROCODE_DEEP_COLLABORATION_PEER_CALLS=<N>`.
- Same-pair ping-pong is guarded independently with a default maximum of **4**
  same-pair roundtrips. It can be overridden with
  `--max-same-pair-roundtrips <N>` or
  `OPENZEROCODE_MAX_SAME_PAIR_ROUNDTRIPS=<N>`.
- `call_peer` supports `oneWay: true`; intents `notify` and `handoff_summary`
  are also treated as one-way messages.
- One-way messages do not consume deep budget and inject a no-reply peer notice
  instead of the normal callback instruction.

This keeps the safe default while allowing user-authorized deeper peer work
without changing source constants.

### Future Budget Improvements

Potential follow-up controls:

- Add a wall-clock budget, e.g. 15–20 minutes.
- Detect repeated cycles such as `A -> B -> A -> B`, not only same-pair count.
- Add a message similarity guard so agents cannot keep exchanging materially
  identical summaries.
- Support intent-specific budgets for `ask_question`, `review_plan`,
  `critique`, `brainstorm`, and `delegate_task`.
- Require persisted intermediate artifacts during long discussions, such as a
  decision log, task breakdown, risk register, and implementation checklist.

### Why default max hop depth = 3?

- hop 0: human initiates
- hop 1: first AI responds
- hop 2: second AI responds to the response
- hop 3: would be a third round-trip, which in practice indicates a loop rather than useful work

Three is conservative enough to catch runaway loops quickly while allowing
legitimate back-and-forth. It is the default budget, not a hard-coded product
limit.
