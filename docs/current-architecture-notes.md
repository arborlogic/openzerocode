# OpenZeroCode — Current Architecture Notes

本文件只記錄目前已確認的架構狀態與短期缺口，不把猜測性提案寫成既定方向。

---

## Current State

- Active client entry: `src/client/tui.tsx`
- Runtime: Bun with `@opentui/solid/preload`
- Old readline client files已移除，不再是 active code path
- Session persistence 已是 multi-session 結構：
  - `~/.openzerocode/sessions/index.json`
  - `~/.openzerocode/sessions/<session-id>.json`
- Provider 已經是 registry 結構：
  - `openapi` / `big-pickle`
  - `cloudflare`
- Message model 已支援 part-based message：
  - `role`
  - `content`
  - `reasoning_content`
  - `tool_calls`
  - `parts`
- Tool execution 目前會直接執行：
  - `abort` 已串進 context
  - `ask()` / `metadata()` 仍是 stub
  - 尚未有完整 permission model

## Confirmed Runtime Behavior

- assistant response 會即時串流到 transcript
- `reasoning_content` 會以獨立 `Thinking` 區塊即時顯示
- response 區塊目前已改為 turn-oriented group
- 純 `user` / `assistant` / `system` 文字不再顯示冗餘 header
- assistant response 目前已有簡易 footer：
  - `provider/model`
  - copy hint
- selection copy 已實作：
  - `onMouseUp`
  - 取 renderer selection
  - 寫入 clipboard
- Build / Plan mode 已實作
  - Plan mode 會傳空的 `toolDefs`
- command palette / provider / model switching 已實作
- session list / rename / delete / compaction 已實作
- sidebar 已顯示 context、token/cost estimate、git diff summary

## Prioritized Backlog

### P0 — Safety / Correctness

- Permission / approval model
- Tool output truncation

### P1 — Coding-Agent Clarity

- Per-message provider/model metadata
- Richer tool-specific rendering
- Response-scoped change summary

### P2 — Interaction Polish

- Smart auto-follow
- Paced streaming
- Diff view

## Notes For Future Work

- 若要新增 roadmap，請只寫「已確認要做」的項目。
- 若只是參考 opencode 的可能方向，請明確標成 idea，而不是 current plan。
