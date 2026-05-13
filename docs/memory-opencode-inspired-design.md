# OpenZeroCode — Opencode-Inspired Memory: Implementation Spec

本文件是 v1 實作規格，對照 opencode 的設計做法。

---

## 對照 opencode 的三個核心

### 1. Workspace Instruction（對應 opencode instruction.ts）

opencode 做法：
- 讀 `AGENTS.md` / `CLAUDE.md`
- 全域 + 專案層
- 每次 LLM call 都注入 system prompt

OpenZeroCode v1 做法：
- 只讀 workspace root 的 `AGENTS.md`
- session 開始時載入，注入 system prompt
- 不自動更新

### 2. Session Persistence（對應 opencode SQLite session storage）

opencode 做法：
- SQLite 存 messages + parts + tool results
- session 有 metadata（model / provider / timestamps）

OpenZeroCode v1 做法：
- JSON 存 messages + model + provider + mode + compaction
- 路徑：`~/.openzerocode/sessions/<session-id>.json`

### 3. Session Compaction（對應 opencode compaction.ts）

opencode 做法：
- context overflow 時觸發
- 產生 anchored summary
- summary 存 DB，不寫 repo 檔案
- 保留最近 tail messages
- 下次組 prompt 時：summary + tail + new message

OpenZeroCode v1 做法：
- context 超過門檻或 `/compact` 手動觸發
- 產生 structured summary（Goal / Progress / Decisions / Files / Next Steps）
- summary 存 `session.compaction.summary`，不寫 repo 檔案
- 保留最近 tail messages

---

## 實作任務清單

### Task 1：移除 SESSION_SUMMARY.md 自動寫入（已完成部分）

- [ ] 移除 `submit()` 後的 `generateSessionSummary(next)`
- [ ] 移除 workspace-memory 對 SESSION_SUMMARY.md 的自動讀取注入
- [ ] 保留檔案支援程式碼，但不進入自動 loop

完成標準：10 turn 對話後，`git diff` 不出現 SESSION_SUMMARY.md 變動。

### Task 2：AGENTS.md 穩定載入

- [x] 找到 workspace root（git root / package.json root）
- [x] 讀取 AGENTS.md（如果存在）
- [x] 注入 system prompt

完成標準：AGENTS.md 裡寫一條規則，下一輪 assistant 確實遵守。

### Task 3：Compaction summary 存進 session JSON

- [ ] 修改 session JSON schema 加入 `compaction` 欄位
- [ ] `/compact` 執行後 summary 寫進 `session.compaction`
- [ ] 組 prompt 時如果有 compaction，加在 AGENTS.md 之後、tail messages 之前

完成標準：`/compact` 後切換 session 再切回來，context 仍有 compaction summary。

### Task 4：Context budget 自動觸發

- [ ] 每次 submit 前估算 token 數
- [ ] 超過 model context limit 80% 時自動觸發 compact

完成標準：長對話不需要手動 compact，自動在接近 limit 時壓縮。

---

## 不做的事（v1 明確排除）

- SESSION_SUMMARY.md 自動讀寫
- 任何 repo 檔案的自動修改
- `.zero/` 目錄
- WORKSPACE_MEMORY.md / WORKSPACE_PROCEDURES.md
- zero-api 整合
- cross-session memory
- directory-aware AGENTS.md（讀檔時沿目錄向上查找）
