# OpenZeroCode — Current Architecture Notes

本文件只記錄目前已確認的實作狀態與短期缺口，避免把猜測性提案寫成既定方向。

---

## Current State

- Active client entry: `src/client/tui.tsx`
- Runtime: Bun with `@opentui/solid/preload`
- Old readline client files已移除，不再是 active code path
- Session persistence 目前只存 `~/.openzerocode/sessions/last.json`
- Provider 目前仍以 `bigPickleLayer` 為單一入口
- Message model 仍為扁平結構：
  - `role`
  - `content`
  - `reasoning_content`
  - `tool_calls`
- Tool execution 目前會直接執行：
  - `abort` 已串進 context
  - `ask()` / `metadata()` 仍是 stub
  - 尚未有完整 permission model

## Confirmed UI Behavior

- assistant response 會即時串流到 transcript
- `reasoning_content` 會以獨立 `Thinking` 區塊即時顯示
- 若 reasoning 比 answer 晚到，UI 會把 `Thinking` 插回 answer 前面
- selection copy 已實作：
  - `onMouseUp`
  - 取 renderer selection
  - 寫入 clipboard
  - 右上角顯示 `Copy`
- Build / Plan mode 已實作
  - Plan mode 會傳空的 `toolDefs`

## Short Backlog

- Message / UI model 改成 part-based 結構
- Tool output truncation
- Permission / approval model
- Multi-session persistence
- Provider registry
- Tool block collapse
- Diff view
- Smart auto-follow
- Paced streaming

## Notes For Future Work

- 若要新增 roadmap，請只寫「已確認要做」的項目。
- 若只是參考 opencode 的可能方向，請明確標成 idea，而不是 current plan。
