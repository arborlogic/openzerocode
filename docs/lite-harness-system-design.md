# Lite Harness MVP 系統設計稿

> **狀態：Draft / MVP experiment**
> **日期：2026-08-14**
> **範圍：OpenZeroCode TUI 的小模型 worker + teacher 雙模型 harness**

## 1. 摘要

Lite mode 要驗證的核心假設是：

> **讓本機小模型沿用現有單 LLM agent loop，使用較短 prompt 與較小工具集合完成工作；另設定一個能力較強的 teacher，只在 compaction 或確實卡關時提供脈絡整理與建議，可以提高小模型完成真實 coding task 的成功率。**

MVP 不是純 local mode。啟用 Lite 前必須設定至少一個 teacher provider/model；沒有 teacher 就不能啟動 Lite run。

兩者分工如下：

- **local worker**：沿用現有單 LLM agent loop，負責讀檔、搜尋、修改、執行測試、收集 evidence 與產生 final response；
- **teacher**：在既有 compaction 發生時整理 checkpoint 並附帶少量下一步建議，或在 worker 明確卡關時提供校正；
- **runtime**：執行既有 tool allowlist、permission、timeout、compaction 與其他安全限制。

Teacher 是按需使用的輔助模型，不是每個 Lite run 都必須實際呼叫的 reviewer，也不是 security boundary。它不取得工具或寫入權，不能取代 runtime permission。MVP 沿用現有單 LLM mode 的結束、approval、compaction 與安全機制，不在這個階段重做完整 Safety Kernel、OS sandbox、成本治理平台或複雜的停滯偵測系統。

---

## 2. MVP 要回答的問題

這個階段優先回答：

1. 縮短 prompt 與工具集合後，小模型是否更會正確使用工具？
2. 讓 teacher 負責 compaction，是否比 worker 自己摘要更能保留 goal、已完成工作與下一步？
3. 少量、按需的 teacher 校正是否能讓 worker 從明確卡關中恢復？
4. Compaction 時附帶的 teacher 建議，是否能幫助 worker 更快選出正確下一步？
5. 相較全程使用大模型，這個模式是否能以較少 teacher tokens 達到可接受成功率？

MVP 的主要產出是可運行的實驗閉環與量測資料，不是一次完成所有 production 配套。

---

## 3. 範圍

### 3.1 MVP 必做

1. `Productive` / `Lite` profile 切換。
2. Lite 使用短 system prompt 與固定 tool allowlist。
3. Lite 必須綁定一個 teacher provider/model。
4. 沿用現有 compaction trigger，由 teacher 產生 checkpoint 並附帶簡短建議。
5. 只在明確卡關訊號出現時按需求助 teacher，不做每步或每次完成 review。
6. Worker 的完成、final response 與 approval 沿用現有單 LLM mode。
7. Teacher 無工具權；所有修改仍由 worker 經既有 runtime 執行。
8. Session 保存 profile、teacher reference、checkpoint 與基本 usage。
9. Fake-provider tests 與一組小型 task suite。

### 3.2 MVP 不做

- 重新設計完整 Safety Kernel；
- OS sandbox、container 或 VM；
- 完整 command risk classifier；
- mutation budget、auto rollback 或自動 commit；
- 動態 capability router；
- 複雜語意型 stall detector；
- 完整美元成本預估、方案控管或 billing UI；
- 90/10 硬配額；
- 多 teacher routing、fallback model chain 或 teacher ensemble；
- 遙測上傳與完整 observability pipeline；
- 讓 teacher 直接呼叫工具或接管 task。

既有 permission、tool execution guard、abort、timeout 與 output limit 照常生效。若現有安全機制有獨立缺陷，應獨立修正，但不作為驗證雙模型閉環前必須完成的大型重構。

---

## 4. 模式模型

```ts
type RunMode = "build" | "plan" | "compose"
type HarnessProfile = "productive" | "lite"

type TeacherConfig = {
  provider: string
  model: string
  maxInputTokens: number
  maxOutputTokens: number
  shareSourceExcerpts: boolean
}
```

MVP 不提供 Lite 的 `teacher: off`。`TeacherConfig` 不完整時：

- UI 可保存 Lite 選擇意圖；
- 送出 Lite task 前必須引導使用者選定 teacher；
- 不可靜默退回 pure-local Lite；
- 不可靜默改用任意 provider/model。

支援矩陣：

| Harness profile | Build | Plan | Compose |
|---|---:|---:|---:|
| Productive | ✅ | ✅ | ✅ |
| Lite | ✅ | ✅（仍為 runtime read-only） | ❌，提示切換 Productive |

Compose 的 orchestration 與 Lite 的小 prompt、少工具目標衝突，因此不納入 MVP。

---

## 5. 核心設計原則

### 5.1 Worker 做事，teacher 稀疏介入

Worker 擁有實際 repo evidence 與完整工具 loop，也沿用現有單 LLM mode 的完成流程。Teacher 不逐步監控、不替 worker 做每一個決策，也不做例行 final review，只出現在兩種情況：

1. **Compaction**：沿用既有 threshold，在重建工作狀態時一併提供少量下一步建議；
2. **Recovery**：worker 出現明確卡關訊號時校正方向。

### 5.2 Teacher 必須設定，但不保證每個 run 都呼叫

Required teacher 的意思是啟用 Lite 前必須有可用的 teacher 設定，讓 runtime 在 compaction 或卡關時能求助；不是把 worker messages 鏡像給大模型，也不是每次完成都觸發 review。

短且順利完成、沒有觸發 compaction 的 task 可以完全不呼叫 teacher。長 task 通常只在既有 compaction 點呼叫；只有確實卡關的 task 才增加 recovery call。

### 5.3 Teacher 是品質防線，不是權限防線

Teacher 回應是 checkpoint 或未驗證建議：

- 沒有 tool schemas；
- 不能呼叫工具；
- 不能直接修改 workspace；
- 不能核准 permission；
- 不能改變 Lite allowlist；
- 內容回到 worker 後，操作仍通過既有 runtime policy。

即使 teacher 說「可安全刪除」，runtime 仍按原本規則決定是否詢問或拒絕。

### 5.4 一個 production loop

Productive 與 Lite 共用 `streamSession()`。差異由 `HarnessPolicy` 注入，不建立第二套 runner，以免 retry、permission 與 tool execution 行為分叉。

### 5.5 MVP 優先可觀察、可比較

所有 teacher call 至少記錄：

- reason；
- input/output tokens；
- latency；
- 成功、失敗或 timeout；
- compaction/recovery 類型與結果；
- recovery 後 worker 是否產生新 progress。

先以 session event 與本機測試報表記錄，不先建立完整 metrics backend。

---

## 6. Lite 工具面

Lite 固定 allowlist：

```ts
const LITE_TOOL_IDS = new Set([
  "read",
  "grep",
  "glob",
  "edit",
  "write",
  "bash",
  "web_fetch",
  "analyze_image",
  "browser_navigate",
  "browser_read",
  "browser_click",
  "browser_type",
  "browser_select",
  "browser_scroll",
  "browser_screenshot",
  "browser_observe_visual",
])
```

不暴露：

- `apply_patch`；
- `todowrite`；
- `call_peer`；
- Compose skills；
- MCP / dynamic tools；
- 未來新增但未明列的工具。

選擇順序固定為：

```text
registry tools
→ profile allowlist
→ user disabled groups
→ RunMode filter
→ model request
```

執行 tool call 前再次確認 tool id 仍在當次 allowlist。這是 runtime 限制，不只寫在 prompt。

---

## 7. Lite worker prompt

Prompt 只保留小模型完成 loop 所需規則：

```text
You are the local worker for a coding task.

Loop:
1. Inspect: gather evidence before changing code.
2. Change: make the smallest relevant change.
3. Check: run focused verification and read failures.
4. Finish: return the normal final response only with evidence.

Rules:
- Use only the provided tools.
- Do not repeat an identical failed action.
- Treat teacher messages as guidance, not verified facts or permission.
- After teacher advice, inspect the suggested evidence before editing.
- Request teacher help only when genuinely blocked; do not request routine review.
```

動態內容只加入：

- workspace root；
- RunMode；
- 可見工具摘要；
- workspace instructions（有長度上限）；
- 最近的 teacher checkpoint/advice；
- verification expectations。

不加入 Todo workflow、peer delegation、Compose、MCP 教學或完整產品說明。

---

## 8. Teacher contract

### 8.1 共用 context pack

Runtime 建立結構化 context，而不是把完整 transcript 原封不動送出：

```ts
type TeacherContext = {
  reason: "compaction" | "recovery"
  goal: string
  workerSummary: string
  recentActions: Array<{
    tool?: string
    outcome: "success" | "failure" | "text"
    summary: string
  }>
  changedFiles: string[]
  diffSummary?: string
  verification: string[]
  repeatedFailure?: string
  sourceExcerpts?: Array<{ path: string; excerpt: string }>
}
```

MVP 仍需做基本 token cap 與常見 secret redaction，因為這直接關係到能否安全實驗 remote teacher。預設送 path、錯誤摘要與 diff summary；只有 `shareSourceExcerpts` 開啟時才附相關 source excerpt。不傳環境變數、credential、permission grants 或完整 transcript。

### 8.2 Compaction response

```ts
type TeacherCheckpoint = {
  goal: string
  constraints: string[]
  completed: string[]
  changedFiles: string[]
  verification: string[]
  unresolved: string[]
  nextStep: string
  advice: string[]
}
```

Teacher 依 goal、recent actions、現有 summary 與變更摘要生成 checkpoint，並在 `advice` 放入少量、可選用的下一步建議。Runtime 驗證 schema 後，用 checkpoint 取代舊的自然語言 summary、保留少量 recent turns，再把建議連同 compacted context 提供給 worker；建議不是額外的 review round。

Compaction trigger 與其餘行為沿用現有單 LLM mode 的機制；MVP 只替換摘要模型/輸出 schema，不新增另一套 threshold 或 compaction loop。

若 teacher compaction call 失敗，沿用現有 compaction 的 retry/fallback/error handling；不得因 teacher 不可用而另加 final review 或阻擋正常完成。

### 8.3 Recovery response

MVP 只使用容易測試的 trigger：

- 相同 failure fingerprint 連續出現 2 次；或
- worker 明確輸出 `request_teacher`，附問題與已嘗試方法。

```ts
type TeacherAdvice = {
  diagnosis: string
  nextSteps: string[]
  inspect: string[]
  risks: string[]
}
```

同一 failure episode 最多自動 recovery 一次。Advice 注入下一個 worker round，並標示「尚未驗證」。MVP 不實作跨多步的語意 progress scoring；若相同失敗在 advice 後仍再次發生，停止該 run 並回報 blocked，避免小模型失控重試。

### 8.4 完成流程

Lite 不新增 `CompletionProposal`、`FinalReview`、`approve/revise` 或 revision cycle。Worker 完成修改與驗證後，直接沿用現有單 LLM mode 的完成判定、approval 行為與 final response。

Teacher advice 若已在最近一次 compaction 或 recovery 產生，worker 應把它視為未驗證建議並自行檢查；但完成時不會因此再呼叫一次 teacher。

---

## 9. 執行流程

```text
1. 使用者選擇 Lite 並送出 task
2. 驗證 teacher provider/model 已設定且可呼叫
3. 建立 Lite prompt 與 runtime tool allowlist
4. local worker 產生文字或 tool call
5. tool call：
   a. schema validation
   b. Lite allowlist validation
   c. 既有 permission / safety checks
   d. execute
   e. 記錄精簡 outcome 與 failure fingerprint
6. context 達既有 threshold：teacher compaction → checkpoint + advice → worker
7. worker 明確 request，或同一 failure fingerprint 連續 2 次：teacher recovery → worker
8. worker 繼續既有 agent loop，完成時直接產生正常 final response
9. 保存 session checkpoint 與 teacher usage events
```

Teacher 不在每個工具步驟後、每次嘗試完成時或結束前被例行呼叫。MVP 流程為：

```text
worker execute
├─ context threshold → teacher checkpoint + advice → worker continue
├─ genuinely blocked → teacher recovery → worker continue
└─ done → existing single-LLM final flow
```

因此，一個未達 compaction threshold 且沒有卡關的 Lite run 可以是零次 teacher call。

---

## 10. 設定與 UI

### 10.1 Preference

```ts
harnessProfile: "productive" | "lite"
teacher?: {
  provider: string
  model: string
  maxInputTokens: number
  maxOutputTokens: number
  shareSourceExcerpts: boolean
}
```

新安裝仍預設 `Productive`，避免 migration 後突然產生外部 request。這不代表 teacher 在 Lite 中 optional；而是 Lite 本身需要使用者明確啟用並完成 teacher 設定。

Credential 只引用既有 secure provider config，不寫入 session。

### 10.2 最小 UI

Command palette：

```text
Harness profile: Productive | Lite
Configure Lite teacher
```

選擇 Lite 但未設定 teacher 時，直接開啟 provider/model picker。啟用 remote teacher 時揭露：相關錯誤、diff summary，以及在 opt-in 後的 source excerpt 可能送往該 provider。

狀態列：

```text
Build · Lite · step 12/50 · Teacher ready
Build · Lite · compacting with teacher
Build · Lite · requesting teacher advice
Build · Lite · teacher unavailable
```

Session event 顯示：

```text
Teacher compaction + advice · 1,420 in / 310 out · 2.1s
Teacher recovery · repeated edit failure · 860 in / 220 out
```

MVP 只顯示 tokens 與次數，不要求精確美元估價。

---

## 11. 與現有程式碼整合

| 區域 | MVP 變更 |
|---|---|
| `src/client/session-runner.ts` | 接受 `harnessProfile` / teacher config；套 Lite allowlist；加入按需 recovery hook |
| `src/client/system-prompt.ts` | 新增精簡 Lite builder |
| `src/tool/selection.ts` | 新增 exact profile allowlist selector 與 runtime tests |
| `src/client/session-compact.ts` | 沿用既有 compaction 流程，支援 teacher checkpoint + advice schema 與現有 fallback |
| `src/client/ui-prefs.ts` | 保存 profile 與 teacher reference |
| `src/client/sessions.ts` | 保存 profile、checkpoint、advice 與 usage events |
| `src/client/tui.tsx` | profile/teacher picker、狀態與 teacher events |

建議新增：

```text
src/harness/types.ts
src/harness/policies.ts
src/harness/lite-prompt.ts
src/harness/teacher.ts
src/harness/teacher-context.ts
```

先不要為 MVP 拆出完整 cost service、progress engine 或新的 safety 子系統。

---

## 12. 實作順序

### Slice 1 — Lite profile 與 worker loop

1. `HarnessProfile` 與 exact Lite allowlist。
2. Lite prompt builder。
3. required `TeacherConfig` 驗證與 picker。
4. 沿用現有單 LLM agent loop、approval 與 final response。
5. 驗證短 task 未觸發 compaction/卡關時不呼叫 teacher。

**完成條件**：小型 edit task 可由 local worker 修改、驗證並正常回覆，且沒有新增 teacher review round。

### Slice 2 — Teacher compaction + advice

1. 在既有 threshold 與 compaction 流程接入 teacher model。
2. 實作 `TeacherCheckpoint` 的 `advice` 欄位。
3. 沿用現有 recent window、retry 與 fallback。
4. 測試 25+ step task 的 goal/verification retention 與 advice 注入。

**完成條件**：長 task compact 後仍保留原始 goal、已改檔案、驗證結果與下一步，worker 同時取得少量 teacher 建議。

### Slice 3 — 最小 recovery 與實驗

1. failure fingerprint 連續兩次才觸發 recovery。
2. worker 明確 `request_teacher` trigger。
3. 同一 failure episode 只求助一次，避免反覆觸發 teacher。
4. 對同一 task suite 跑 Productive、Lite worker-only baseline（僅測試環境）、Lite + teacher。
5. 記錄成功率、tokens、latency、schema/tool errors、compaction 與 recovery rate。

**完成條件**：teacher 只在 compaction 或明確卡關時被呼叫，且能量測它對長程脈絡與卡關恢復的實際 uplift。

Worker-only baseline 只作離線對照實驗，不是產品可選的 Lite 運行模式。

---

## 13. 測試策略

### 13.1 Unit tests

- Lite allowlist 是精確集合，dynamic/MCP tools 不會自動加入；
- Lite prompt 不含 Todo、Compose、peer 或 MCP 指令；
- Lite run 缺少 teacher config 時拒絕開始；
- teacher context token cap 與 secret redaction；
- checkpoint/advice schema parser；
- malformed teacher payload 不會變成 tool call；
- failure fingerprint 第二次才觸發，且同 episode 不重複呼叫；
- 未達 compaction threshold 且未卡關時 teacher call count 為 0；
- Lite 完成流程與現有單 LLM mode 一致。

### 13.2 Integration tests

使用 scripted worker/teacher provider 驗證：

1. worker 完成短 edit + test → 沒有 teacher call → 沿用正常 final；
2. 第一次 tool failure → 不觸發 teacher；
3. 相同 failure fingerprint 連續兩次 → recovery advice → worker 改變方法；
4. 同一 failure episode 後續失敗不重複呼叫 teacher；
5. worker 明確 request teacher → recovery advice → worker 繼續；
6. 25+ steps 觸發既有 compaction → goal、changes、verification 與 advice 保留；
7. compaction failure → 沿用現有 fallback/error handling；
8. worker 完成時不觸發 final review；
9. worker 嘗試未列工具 → runtime 拒絕；
10. Plan + Lite 的 mutation tool 不可執行。

### 13.3 MVP 指標

- task success rate；
- worker / teacher input-output tokens；
- total latency；
- tool schema error rate；
- repeated failure rate；
- compaction 後 goal retention；
- compaction advice 後是否採取有效 action；
- recovery 後是否出現不同且有效的 action；
- 零 teacher call 的 run 比例；
- 每個 run 的 compaction/recovery call 次數。

90/10 只作觀察值，不作硬性 acceptance gate。應保留真實 token 與成功率結果；控制成本的主要手段是稀疏觸發，而不是對每個 run 增加固定 review。

---

## 14. MVP Acceptance Criteria

功能：

- Lite 未設定 teacher 時不能開始；
- local worker 使用精簡 prompt 與固定 allowlist；
- 既有 context threshold 可觸發 teacher compaction，並回傳 checkpoint + advice；
- 明確卡關可觸發一次 teacher recovery；
- 未觸發 compaction 且未卡關的 run 不呼叫 teacher；
- worker 完成時不觸發 teacher final review；
- 完成、approval 與 compaction fallback 沿用現有單 LLM mode；
- session restore 後 profile、teacher reference 與 checkpoint 不漂移。

邊界：

- teacher 沒有 tools、permission 或 workspace write access；
- worker 操作仍通過既有 runtime allowlist 與 permission；
- remote context 有 cap、基本 redaction 與 source-sharing opt-in；
- 不引入第二套 production agent loop。

實驗：

- 至少使用兩個目標 local model 跑同一 task suite；
- 能分別觀察 teacher compaction advice 與 recovery 的效果；
- Lite + teacher 相較 worker-only baseline 有可量測結果；
- 報表包含成功率、token、latency、零呼叫比例與 compaction/recovery 統計。

---

## 15. 已定案與後續決策

MVP 已定案：

1. Teacher 必須在 Lite 啟用前設定，但單一 run 可以完全不呼叫。
2. Compaction 沿用現有機制，由 teacher 生成 checkpoint 並附帶建議。
3. Teacher 只在 compaction 或明確卡關時觸發，不做例行 final review。
4. 完成與 approval 沿用現有單 LLM mode。
5. Teacher 不取得工具；runtime 才是安全與權限邊界。
6. 優先跑通能力實驗，不先建完整配套平台。

實驗後再決定：

- compaction threshold 是否需依模型/context 動態調整；
- recovery 是否需要更精細的 no-progress detector；
- teacher token/cost hard budget 的產品預設；
- teacher provider fallback；
- 是否需要比「連續兩次相同 failure」更精細的稀疏觸發規則；
- 是否值得補上 mutation budget、進階 safety classifier 與完整 observability。
