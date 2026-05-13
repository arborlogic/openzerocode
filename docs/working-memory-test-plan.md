# OpenZeroCode — Working Memory Test Plan

本文件定義一份 **真實使用情境** 的測試計劃，用來驗證目前的 working memory loop 是否已經足夠可用。

這份計劃只驗證目前 phase 的責任：

- 讀 `AGENTS.md`
- 讀 / 寫 `SESSION_SUMMARY.md`
- 讓下一次 session 能延續上一輪工作

不驗證：

- long-term promotion
- `AGENTS.md` 自動寫回
- zero integration
- sqlite

---

## Goal

確認 OpenZeroCode 在真實任務下，是否已具備可用的 workspace-level working memory。

更具體地說，要驗證：

1. `AGENTS.md` 能否穩定影響當前 session 行為
2. `SESSION_SUMMARY.md` 是否能產出高品質 handoff
3. 下一次 session 是否能有效接續前一次狀態
4. summary 內容是否真的幫助減少重複探索與重複犯錯

---

## Success Criteria

只要以下條件大多成立，就代表目前 working memory loop 可接受：

- agent 能正確讀到 `AGENTS.md` 裡的 repo-specific 規則
- 每次任務結束後都會穩定產生 `SESSION_SUMMARY.md`
- `SESSION_SUMMARY.md` 的 `Next Steps` 是可執行的，不空泛
- `Critical Context` 能保留真正重要的 repo-specific 修正或限制
- `Relevant Files` 有具體路徑，而且能說明為什麼重要
- 第二次進入同一 repo 時，agent 不需要重新探索已知上下文
- summary 不會退化成聊天紀錄或冗長逐字摘要

---

## Failure Signals

出現以下現象時，代表目前 prompt 或資料流還不夠穩：

- `SESSION_SUMMARY.md` 大量重述對話語氣，而不是工作 handoff
- `Next Steps` 寫成模糊句子，例如「continue working」
- `Critical Context` 缺少真正關鍵的錯誤、修正、限制
- `Relevant Files` 缺少路徑，或沒有 `path: why it matters`
- 第二次 session 還是在重做第一輪已經確認過的探索
- summary 把不重要的細節寫很多，但漏掉真正阻礙後續工作的資訊

---

## Test Setup

每輪測試都盡量維持同樣前提：

1. 使用真實 repo，不要用過度簡化的 toy example
2. repo root 內有：
   - `AGENTS.md`
   - `SESSION_SUMMARY.md` 可不存在，讓系統自動建立
3. 每輪任務開始前，保留上一輪 summary 結果
4. 每輪測試後人工檢查產出的 `SESSION_SUMMARY.md`

建議至少準備兩種 repo：

- `TypeScript / frontend or fullstack repo`
- `backend or CLI repo`

這樣可以避免 prompt 只對單一專案形態有效。

---

## Test Matrix

### Scenario 1 — Repo Rule Compliance

目的：

驗證 `AGENTS.md` 是否真的能影響當前 session 行為。

前置：

- 在 `AGENTS.md` 放 3 到 5 條高訊號規則
- 至少包含：
  - package manager
  - test command
  - 不該改的路徑或 generated file 規則

操作：

1. 啟動新 session
2. 下達一個需要讀檔、改檔、跑測試的任務
3. 觀察 agent 是否直接遵守 `AGENTS.md`

驗收：

- 沒有猜錯 package manager
- 沒有碰禁止修改的路徑
- 有使用正確測試命令

失敗例：

- 明明寫了 `pnpm` 還跑 `npm`
- 明明寫了 generated files 不要改，還去修改

### Scenario 2 — Single-Session Summary Quality

目的：

驗證一次任務結束後，summary 本身是否可讀、可接手。

操作：

1. 啟動新 session
2. 執行一個中等複雜度任務
   - 例如新增一個 API route
   - 或修一個跨 2 到 4 個檔案的 bug
3. 完成後檢查 `SESSION_SUMMARY.md`

重點檢查：

- `Goal` 是否正確
- `Done` 是否有真正完成的項目
- `In Progress` / `Blocked` 是否誠實
- `Next Steps` 是否真的可執行
- `Relevant Files` 是否有 `path: why it matters`
- `Critical Context` 是否保留了真正會影響下一輪的資訊

通過標準：

- 一位沒看過對話的人，只看 summary 就能大致接手

### Scenario 3 — Multi-Session Continuation

目的：

驗證 `SESSION_SUMMARY.md` 是否真的有 continuation 價值。

操作：

1. 第一輪 session 做一半就停止
   - 例如只完成 route / schema，還沒補測試
2. 確認 `SESSION_SUMMARY.md` 已生成
3. 關掉 session
4. 開一個新的 session
5. 直接要求接續剛剛的任務

驗收：

- agent 能直接接上未完成工作
- agent 不需要重新探索上一輪已經明確的檔案與決策
- `Next Steps` 對第二輪真的有幫助

失敗例：

- 第二輪重新從頭 grep 同一批已明確的檔案
- 完全忽略上一輪留下的 pending work

### Scenario 4 — Correction Retention

目的：

驗證重要修正是否會進入 `Critical Context`。

操作：

1. 在 session 中故意讓 agent 遇到一個 repo-specific 修正
   - 例如測試命令不是預設值
   - 或某個 generated directory 不能改
2. 明確糾正 agent
3. 完成任務後檢查 `SESSION_SUMMARY.md`
4. 下一輪 session 再做相近任務

驗收：

- `Critical Context` 有保留這個修正
- 下一輪 agent 不再犯同樣的錯

### Scenario 5 — Relevant Files Precision

目的：

驗證 `Relevant Files` 不是亂列，而是真的對 continuation 有幫助。

操作：

1. 執行一個會跨多個檔案的任務
2. 檢查 `Relevant Files`

驗收：

- 每個條目都包含明確 path
- 每個條目都說明為什麼重要
- 條目數量精簡，不要把所有 touched files 全列進去

理想格式：

```md
- src/routes/auth.ts: route registration for login flow
- src/handlers/login.ts: login business logic and validation
- src/schemas/auth.ts: request/response schema used by the route
```

### Scenario 6 — Noise Resistance

目的：

驗證 summary 不會被閒聊或低價值內容污染。

操作：

1. 在 session 中加入一些不重要對話
2. 再完成一個實際任務
3. 檢查 `SESSION_SUMMARY.md`

驗收：

- summary 還是偏 handoff，不是 conversation recap
- 不重要的閒聊不會進入 `Critical Context` 或 `Relevant Files`

---

## Recommended Test Tasks

建議至少跑 3 種任務：

1. 新增功能
   - 例如新增 API endpoint、加入欄位、增加按鈕行為

2. 修 bug
   - 例如修 route registration、修測試失敗、修資料流問題

3. 半完成任務交接
   - 故意做一半，測 continuation 品質

這三種最能看出 summary 到底是在記「完成紀錄」，還是在做「工作交接」。

---

## Review Rubric

每次跑完一輪，用下面 rubric 打分：

### A. Goal Accuracy

- 0: 任務摘要錯誤
- 1: 大致正確但模糊
- 2: 簡潔且準確

### B. Next Steps Usefulness

- 0: 幾乎不能執行
- 1: 有方向但太模糊
- 2: 明確且能直接接著做

### C. Critical Context Quality

- 0: 漏掉關鍵限制或修正
- 1: 部分保留，但不完整
- 2: 只保留真正重要且會影響下一輪的資訊

### D. Relevant Files Quality

- 0: 沒列，或列得很亂
- 1: 有路徑但缺乏用途說明
- 2: 路徑精準，且每條都有 continuation 價值

### E. Continuation Value

- 0: 第二輪幾乎沒幫助
- 1: 有些幫助，但還是重做很多探索
- 2: 第二輪能明顯更快接手

建議：

- 每輪總分滿分 10
- 平均 7 分以上可視為目前可用
- 若連續兩輪低於 6，優先調整 summary prompt

---

## Execution Plan

建議的執行順序：

1. 跑 Scenario 1
2. 跑 Scenario 2
3. 跑 Scenario 3
4. 跑 Scenario 4
5. 跑 Scenario 5
6. 視情況補 Scenario 6

這樣能先驗證：

- rule compliance
- summary quality
- continuation ability

再驗證：

- correction retention
- file precision
- noise resistance

---

## What To Adjust If It Fails

如果測試失敗，優先調整：

1. `buildSessionSummaryPrompt()` 的 section rules
2. `Critical Context` 的選擇規則
3. `Relevant Files` 的輸出格式要求
4. `Next Steps` 是否夠 action-oriented

不要第一時間就導入：

- sqlite
- candidate lifecycle
- long-term memory promotion
- zero integration

因為這些不會解決 summary 品質問題。

---

## Exit Criteria

當以下條件成立時，可以視為 working memory v1 已驗證完成：

- 至少完成 3 輪真實任務測試
- 至少 1 輪 multi-session continuation 測試成功
- summary rubric 平均分數 >= 7/10
- 沒有明顯 recurring failure，例如：
  - 一直漏 `Next Steps`
  - 一直亂列 `Relevant Files`
  - 一直把閒聊寫進 summary

達到這些條件後，再考慮下一步：

- summary rotation / archive strategy
- 更細的 repo boundary behavior
- 後續 zero integration contract

---

## Baseline Results

本區記錄已經實際跑過的案例，讓後續回歸測試有可對照的 baseline。

### Run 1 — README Command / Testing Note Update

Date:

- 2026-05-13

Scenario Coverage:

- Scenario 1 — Repo Rule Compliance
- Scenario 2 — Single-Session Summary Quality

Task:

- Update `README.md` to mention `npm run start:tui` as a valid start command.
- Add a targeted test example using `npx tsx --test <file>`.
- Keep the testing note aligned with `AGENTS.md` so `npm test` is not implied as the default smoke test.

Observed Behavior:

- Agent followed `AGENTS.md` guidance and did not treat `npm test` as the default smoke test.
- Agent used `npm run typecheck` for verification.
- `SESSION_SUMMARY.md` was generated with a usable handoff structure.

Artifacts:

- [README.md](/Users/masato/Dev/ai-util/openzerocode/README.md:1)
- [AGENTS.md](/Users/masato/Dev/ai-util/openzerocode/AGENTS.md:1)
- [SESSION_SUMMARY.md](/Users/masato/Dev/ai-util/openzerocode/SESSION_SUMMARY.md:1)

Rubric Score:

- Goal Accuracy: 2/2
- Next Steps Usefulness: 2/2
- Critical Context Quality: 2/2
- Relevant Files Quality: 2/2
- Continuation Value: 2/2
- Total: 10/10

Notes:

- The first provider-backed summary generation was too sparse and placed routine verification into `Critical Context`.
- The summary prompt was then tightened to exclude routine verification from `Critical Context` unless it represents a non-obvious repo requirement.
- After that prompt adjustment, the regenerated summary reached the expected quality bar.

Follow-up:

- Next recommended validation is Scenario 3 — Multi-Session Continuation.

### Run 2 — Partial Task Handoff / Continuation

Date:

- 2026-05-13

Scenario Coverage:

- Scenario 3 — Multi-Session Continuation

Task:

- Update `README.md` and `docs/current-ui-notes.md` so both mention that targeted local tests can use `npx tsx --test <file>`.
- Keep the guidance aligned with `AGENTS.md` about provider-gated tests.
- Intentionally stop after updating only `README.md`.

Observed Behavior:

- `SESSION_SUMMARY.md` correctly preserved the unfinished work.
- `In Progress` explicitly recorded that `docs/current-ui-notes.md` still needed the same testing guidance.
- `Next Steps` correctly pointed to updating `docs/current-ui-notes.md`.
- `Critical Context` preserved the repo-specific fact that `npm test` is not a universal smoke test because provider-facing tests require `OPENCODE_API` / `OPENCODE_API_KEY`.
- `Relevant Files` correctly included the already-changed file, the still-pending file, and the two provider-gated test files that justify the rule.

Artifacts:

- [SESSION_SUMMARY.md](/Users/masato/Dev/ai-util/openzerocode/SESSION_SUMMARY.md:1)
- [README.md](/Users/masato/Dev/ai-util/openzerocode/README.md:1)
- [docs/current-ui-notes.md](/Users/masato/Dev/ai-util/openzerocode/docs/current-ui-notes.md:1)
- [AGENTS.md](/Users/masato/Dev/ai-util/openzerocode/AGENTS.md:1)

Rubric Score:

- Goal Accuracy: 2/2
- Next Steps Usefulness: 2/2
- Critical Context Quality: 2/2
- Relevant Files Quality: 2/2
- Continuation Value: 2/2 at artifact level
- Total: 10/10 at artifact level

Notes:

- The working-memory artifact itself is strong enough to support continuation.
- A provider-backed follow-up prompt asking “what should you do next?” returned an empty continuation response in this synthetic test harness.
- Because of that, this run should be marked:
  - artifact-level continuation: pass
  - agent-response-level continuation: inconclusive

Follow-up:

- Validate the same scenario in a real TUI cross-session run instead of only through synthetic provider calls.
