# OpenZeroCode — Memory Architecture (v1)

本文件是 v1 的決定記錄，不是討論稿。

---

## v1 Decision

**v1 只做三件事：**

1. `AGENTS.md` 穩定載入為 workspace instruction
2. session JSON 穩定保存 messages + compaction summary
3. context 超過門檻才 compact

**v1 不做：**

- SESSION_SUMMARY.md 自動更新
- 任何 repo 檔案的自動寫入
- cross-session 記憶演化
- `.zero/` 目錄
- WORKSPACE_MEMORY.md / WORKSPACE_PROCEDURES.md
- zero-api 整合

---

## Prompt 組裝順序

```
System Prompt
  ↓
AGENTS.md（如果存在）
  ↓
Compaction Summary（如果這個 session 曾經 compact 過）
  ↓
Recent Tail Messages
  ↓
Current User Message
```

---

## 各元件職責

### AGENTS.md

- workspace-level 的唯一 instruction 來源
- 只放 stable、high-signal、執行前必須知道的事實
- 由人類維護，不自動更新
- 放在 workspace root（project root / git root）

適合放的內容：

- package manager（bun / pnpm / npm）
- test command
- 不能動的 generated files
- known gotchas / constraints
- repo structure 事實

不應該放：

- session 細節
- 臨時工作狀態
- generic programming advice

### Session JSON

路徑：`~/.openzerocode/sessions/<session-id>.json`

儲存：

```json
{
  "id": "session-abc",
  "messages": [],
  "model": "...",
  "provider": "...",
  "mode": "build",
  "compaction": {
    "summary": "...",
    "createdAt": "...",
    "sourceMessageCount": 28
  },
  "createdAt": "...",
  "updatedAt": "..."
}
```

`compaction` 欄位只有在 compact 過後才存在。

### Compaction

- 觸發條件：估算 token 超過 model context limit 的門檻（建議 80%）
- 手動觸發：`/compact` 指令
- 輸出：summary 寫回 `session.compaction.summary`，不寫任何 repo 檔案
- 保留最近 N 條 messages 作為 tail

---

## SESSION_SUMMARY.md 的處理

v1 中不進入自動流程。

不自動讀取、不自動寫入。

如果未來要支援，作為手動指令（`/export-summary`），由使用者自行決定。

---

## 為什麼這樣決定

| 問題 | 原本做法 | v1 做法 |
|---|---|---|
| 每 turn 多一次 LLM call | 每次 submit 後呼叫 generateSessionSummary | 移除 |
| git diff 被污染 | SESSION_SUMMARY.md 每 turn 變動 | 不寫 repo 檔案 |
| 多 session 共用 summary 打架 | 所有 session 覆蓋同一個檔案 | summary 存 session JSON |
| session context 被誤當 workspace memory | SESSION_SUMMARY.md 自動注入 | 只注入 AGENTS.md |

---

## 未來可能演化（不在 v1 範圍）

- directory-aware AGENTS.md（讀某個路徑時沿目錄向上找對應 AGENTS.md）
- CLAUDE.md 相容層
- cross-session memory 萃取（zero 整合）
- WORKSPACE_MEMORY.md / WORKSPACE_PROCEDURES.md 拆檔
