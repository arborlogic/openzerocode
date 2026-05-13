# OpenZeroCode — Opencode-Inspired Memory: Implementation Retrospective

> **Status: ✅ 所有 v1 任務已完成 — 此為實作回顧，非待辦清單。**

本文件回顧 OpenZeroCode 的 working memory 實作，對照 opencode 的設計做法，並記錄已完成的實作項目。

---

## 對照 opencode 的三個核心

### 1. Workspace Instruction（對應 opencode instruction.ts）

| 面向 | opencode | OpenZeroCode (已實作) |
|------|----------|----------------------|
| 讀取來源 | `AGENTS.md` / `CLAUDE.md` | workspace root 的 `AGENTS.md` |
| 載入時機 | 每次 LLM call | session 開始時載入，注入 system prompt |
| 自動更新 | 無 | 不自動更新（由人類維護） |
| 實作檔案 | `instruction.ts` | `src/client/workspace-memory.ts` |

### 2. Session Persistence（對應 opencode SQLite session storage）

| 面向 | opencode | OpenZeroCode (已實作) |
|------|----------|----------------------|
| 儲存方式 | SQLite | JSON 檔案 |
| 儲存內容 | messages + parts + tool results | messages + model + provider + mode + compaction + permissionRules + autoApprove |
| 路徑 | SQLite DB | `~/.openzerocode/sessions/<session-id>.json` |
| 實作檔案 | session storage | `src/client/sessions.ts` |

### 3. Session Compaction（對應 opencode compaction.ts）

| 面向 | opencode | OpenZeroCode (已實作) |
|------|----------|----------------------|
| 觸發方式 | context overflow | 自動（80% threshold）或 `/compact` 手動 |
| Summary 格式 | anchored summary | Structured (Goal / Progress / Decisions / Files / Next Steps) |
| 儲存位置 | DB | `session.compaction.summary` in JSON |
| 保留 tail | ✅ | ✅ 保留最近 N 條 messages |
| 實作檔案 | `compaction.ts` | `src/client/session-compact.ts` |

---

## 實作完成確認

### Task 1：移除 SESSION_SUMMARY.md 自動寫入 ✅

- [x] 移除自動 `generateSessionSummary(next)` — session summary 不再自動產生
- [x] 移除對 SESSION_SUMMARY.md 的自動讀取注入
- [x] 保留手動匯出指令（`/export-summary`）供使用者自行決定

**驗證：** 10 turn 對話後 `git diff` 不應出現 SESSION_SUMMARY.md 變動。

### Task 2：AGENTS.md 穩定載入 ✅

- [x] 找到 workspace root（git root / package.json root）
- [x] 讀取 AGENTS.md（如果存在）
- [x] 注入 system prompt

**驗證：** AGENTS.md 裡的規則會在下一輪被 assistant 遵守。

**實作：** `src/client/workspace-memory.ts` — `loadAgentsInstruction()`

### Task 3：Compaction summary 存進 session JSON ✅

- [x] session JSON schema 包含 `compaction` 欄位（`saveSession()`）
- [x] `/compact` 執行後 summary 寫進 `session.compaction`
- [x] prompt 組裝順序：system → AGENTS.md → compaction → tail → user message

**驗證：** `/compact` 後切換 session 再切回來，context 仍有 compaction summary。

**實作：** `src/client/sessions.ts` + `src/client/session-runner.ts`

### Task 4：Context budget 自動觸發 ✅

- [x] 每次 submit 前估算 token 數
- [x] 超過 model context limit 80% 時自動觸發 compact

**驗證：** 長對話不需要手動 compact，自動在接近 limit 時壓縮。

**實作：** `src/client/tui.tsx` — `estimateTokenCount()` + auto-compact check

---

## 不做的事（v1 明確排除，仍維持）

- SESSION_SUMMARY.md 自動讀寫
- 任何 repo 檔案的自動修改
- `.zero/` 目錄
- WORKSPACE_MEMORY.md / WORKSPACE_PROCEDURES.md
- zero-api 整合
- cross-session memory
- directory-aware AGENTS.md（讀檔時沿目錄向上查找）
