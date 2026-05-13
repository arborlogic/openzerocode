# OpenZeroCode — Current Architecture Notes

> **Status: ✅ 穩定版 — 此為 v1 已實作架構的記錄文件。**

本文件記錄目前已確認的架構狀態與後續可考慮的方向，不把猜測性提案寫成既定方向。

---

## Current Stable State

### 核心架構

- **Active client entry**: `src/client/tui.tsx`
- **Runtime**: Bun with `@opentui/solid/preload`
- **Old readline client**: 已移除，不再是 active code path

### Session Persistence

Multi-session JSON 結構（已穩定）：

- `~/.openzerocode/sessions/index.json`
- `~/.openzerocode/sessions/<session-id>.json`
- session JSON 儲存：messages、model、provider、mode、compaction、permissionRules、autoApprove

### Memory Policy（v1 ✅）

| 項目 | 狀態 |
|------|------|
| `AGENTS.md` 載入為 workspace instruction | ✅ 已實作 (`workspace-memory.ts`) |
| `SESSION_SUMMARY.md` 不進入自動 loop | ✅ 不自動讀寫 |
| Compaction summary 存 session JSON | ✅ 不寫 repo 檔案 |
| Context budget 自動觸發 compaction | ✅ 80% threshold |

詳細設計請見 [memory-architecture.md](memory-architecture.md)

### Provider 層

Registry 結構（已穩定）：

- `openrouter` — OpenRouter API
- `big-pickle` — Big Pickle API
- 可透過 registry 擴充

實作：`src/provider/registry.ts` + `src/provider/config.ts`

### Message Model

已支援 part-based message：

- `role`, `content`, `reasoning_content`, `tool_calls`, `parts`

### Permission / Auto-Approve（已實作 ✅）

- **`permission-rules.ts`**: `isSafePermission()`, `shouldAutoApprove()`, `addPermissionRules()`, `isDangerousBashCommand()`
- **Dangerous command detection**: rm, rmdir, mv, truncate, shred, dd, `>` 等 destructive patterns
- **Normalization**: 處理 env var prefix (`VAR=val rm`) 與 `sudo` prefix
- **Auto-approve toggle**: 在 TUI 中可透過 `/auto` 指令或 palette 切換
- **Session persistence**: autoApprove 狀態存於 session JSON

### Tool Execution

- `abort` 已串進 context
- `ask()` permission callback 已整合 auto-approve logic
- `metadata()` 可用

## Confirmed Runtime Behavior

- assistant response 即時串流到 transcript
- `reasoning_content` 以獨立 `Thinking` 區塊即時顯示
- response 為 turn-oriented group
- 純 `user` / `assistant` / `system` 文字不再顯示冗餘 header
- assistant response footer：provider/model + copy hint
- selection copy 已實作（onMouseUp → renderer selection → clipboard）
- Build / Plan mode 已實作（Plan mode 傳空的 `toolDefs`）
- command palette / provider / model switching 已實作
- session list / rename / delete / compaction 已實作
- sidebar 顯示 context、token/cost estimate、git diff summary

## 已驗證 (Test Coverage)

| 模組 | 測試檔案 |
|------|---------|
| Workspace memory | `workspace-memory.test.ts` |
| Permission rules | `permission-rules.test.ts` |
| Session state | `session-state.test.ts` |
| Session persistence | `sessions.test.ts` |
| Session compaction | `session-compact.test.ts` |
| Message sanitization | `message-sanitize.test.ts` |
| System prompt | `system-prompt.test.ts` |
| Stream state | `stream-state.test.ts` |
| Autocomplete | `autocomplete.test.ts` |
| Commands | `commands.test.ts` |
| Errors | `errors.test.ts` |
| Markdown | `markdown.test.ts` |

## Future Considerations（明確標為 idea，非 current plan）

### P1 — Coding-Agent Clarity

- Per-message provider/model metadata
- Richer tool-specific rendering
- Response-scoped change summary

### P2 — Interaction Polish

- Smart auto-follow
- Paced streaming
- Diff view

## Notes

- 若要新增 roadmap，請只寫「已確認要做」的項目。
- 若只是參考 opencode 的可能方向，請明確標成 idea，而不是 current plan。
