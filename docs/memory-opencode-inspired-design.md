# OpenZeroCode — Opencode-Inspired Memory Design

本文件定義一條 **循序漸進** 的 memory 設計路線：

- 儘量模仿 `submodules/opencode` 現在已經證明可用的做法
- 不一開始就做太重的 global memory
- 但從第一版開始就預留未來接到 `zero` 的接口

這份文件和 [memory-architecture.md](/Users/masato/Dev/ai-util/openzerocode/docs/memory-architecture.md:1) 的關係是：

- `memory-architecture.md` 定義理念與分層
- 本文件定義 **怎麼從現在的 OpenZeroCode 實際長成那個架構**
- sqlite 是否應該現在導入，參考 [sqlite-adoption-checklist.md](/Users/masato/Dev/ai-util/openzerocode/docs/sqlite-adoption-checklist.md:1)

---

## Design Goal

最重要的要求不是「功能最多」，而是：

1. 第一版就有用
2. 第一版就透明
3. 第一版不要綁死未來架構
4. 未來可以自然升級到 zero memory evolution

所以這份設計的核心原則是：

> 先做像 opencode 的 local instruction / session summary / context attachment。  
> 之後再把這些 local artifacts 接到 zero 的 extracted memory pipeline。

同時固定一條更上層的產品原則：

> OpenZeroCode 在沒有 zero 的情況下，也必須像 opencode 一樣完整可用；zero 不是基礎依賴，而是補 operator 的習慣、慣例、偏好與思維規範。

換句話說：

- OpenZeroCode 負責 workspace-level execution
- zero 負責 operator-level learning

再補一條互動層原則：

> memory 應該是持續理解底層，而不是需要頻繁手動操作的 command system。

所以在產品體驗上：

- `AGENTS.md` / `SESSION_SUMMARY.md` 是底層 artifact
- summary 應該自動產生
- `/memory ...` 這類 command 只適合作為暫時 debug surface
- 這個階段先不把 long-term rule promotion 當主線

更明確地說：

> OpenZeroCode 目前只負責 working memory；是否形成長期規則，先 defer 給 zero。

## Why Start From Opencode

`opencode` 現在最成熟、最值得模仿的 memory 相關能力，不是 long-term memory，而是這三件事：

### 1. Workspace-local instruction files

它會讀：

- 全域 `AGENTS.md`
- 專案層 `AGENTS.md`
- `CLAUDE.md`
- 讀某個檔案後，再沿目錄向上找附近 instruction files

參考：

- [instruction.ts](/Users/masato/Dev/ai-util/openzerocode/submodules/opencode/packages/opencode/src/session/instruction.ts:1)

這代表它非常重視：

- local context
- nearest instruction wins
- instruction 是可讀、可改、repo-bound 的

### 2. Session compaction / anchored summary

`opencode` 不是把所有歷史永遠硬塞進 context，而是會：

- 偵測 overflow
- 保留最近 tail turns
- 把舊歷史壓成 anchored summary

參考：

- [compaction.ts](/Users/masato/Dev/ai-util/openzerocode/submodules/opencode/packages/opencode/src/session/compaction.ts:1)

這代表它非常重視：

- working memory 要可控
- summary 要有固定結構
- 最近上下文與長期摘要要分開

### 3. Initialize / instruction curation mindset

`opencode` 的 initialize prompt 很明確：

- 只保留 agent 容易猜錯的高訊號事實
- 優先讀 executable source of truth
- docs 與 config 衝突時，以可執行真相為準

參考：

- [initialize.txt](/Users/masato/Dev/ai-util/openzerocode/submodules/opencode/packages/opencode/src/command/template/initialize.txt:1)

這一點很適合拿來設計 workspace memory 的寫入規則。

## What We Intentionally Do Not Copy

雖然這份設計以 opencode 為起點，但有幾件事不直接照搬：

### 1. 不把 memory 等同於 instruction file

opencode 的 `AGENTS.md` 比較偏 instruction。

OpenZeroCode 這裡希望更清楚拆成：

- workspace facts
- workspace procedures
- trace summary

所以不只是一個 `AGENTS.md`。

### 2. 不把 compaction 當成 long-term memory

opencode 的 compaction 是 session working memory 管理。

這裡會借用它的摘要結構與節奏感，但不把它誤認成跨 workspace 的記憶系統。

### 3. 不把所有東西一開始就塞進 zero

這是和 `zero-api` 最大的結合原則：

- local workspace memory 先存在 repo 旁
- zero 只接收後續萃取出來的候選知識

而且這不只是技術選擇，也是產品邊界：

- `openzerocode` 不應依賴 `zero` 才能變得可用
- `zero` 補的是跨 workspace、偏 operator 的長期歸納
- repo-local facts / procedures 應該先在本地成立

## Adopt / Adjust / Defer

目前這一階段，最適合和 `opencode` 對齊的切法如下：

| 類別 | 做法 |
|---|---|
| 沿用 | `AGENTS.md` 作為主要 workspace instruction 入口 |
| 沿用 | 向上尋找最近 instruction file 的思路 |
| 沿用 | session summary / anchored summary 的結構化摘要思路 |
| 沿用 | 只保留高訊號、agent 容易猜錯的資訊 |
| 調整 | 不把 instruction file 直接等同 long-term memory |
| 調整 | 不把 compaction 直接等同 memory system |
| 調整 | 不做 `.zero/` 目錄 |
| 調整 | 第一版以 `AGENTS.md + SESSION_SUMMARY.md` 為主 |
| 延後 | `CLAUDE.md` 相容層 |
| 延後 | directory-aware 的更細粒度 memory attachment |
| 延後 | `WORKSPACE_MEMORY.md` / `WORKSPACE_PROCEDURES.md` 拆檔 |
| 延後 | export-to-zero candidate pipeline |

## Minimal First Structure

這一階段不需要為 zero 預留特殊目錄。

最小版本建議：

```txt
AGENTS.md
SESSION_SUMMARY.md
```

如果後續內容真的長出來，再補中性檔名：

```txt
AGENTS.md
SESSION_SUMMARY.md
WORKSPACE_MEMORY.md
WORKSPACE_PROCEDURES.md
```

### File Roles

#### `AGENTS.md`

第一版的主載體。

記錄：

- workspace 具體事實
- repo 規則
- 高訊號 command
- agent 容易猜錯的限制
- 少量已穩定的 procedure

正式規則：

> 只寫 stable, high-signal, execution-critical workspace instructions。

適合先放：

- package manager
- test command
- generated file 規則
- repo structure 事實
- deployment / runtime 事實
- known gotchas

#### `SESSION_SUMMARY.md`

記錄**單份最新** session 的高階摘要，偏 working handoff。

適合放：

- 這次任務做了什麼
- 變更了哪些檔案
- 跑了哪些 command
- 遇到哪些修正
- 產生了哪些 candidate memory / procedure

第一版建議策略：

- 每次 session 結束時重寫
- 保留最新一份 anchored summary
- 不 append 全部歷史

更舊的 trace 如果未來真的需要，再另外設計 archive / export。

#### `WORKSPACE_MEMORY.md` / `WORKSPACE_PROCEDURES.md`

這兩份不是第一版必要條件。

只有在下列情況才建議拆出來：

- `AGENTS.md` 已經太長
- facts 和 procedures 已經明顯是兩種不同內容
- 需要更清楚地區分靜態規則與可演化流程

## Retrieval Model

第一版要儘量模仿 opencode 的「local-first instruction attach」思路。

### Phase 1 Retrieval

每次進入 workspace 或開始 session 時：

1. 讀 `AGENTS.md`
2. 如果有，讀 `SESSION_SUMMARY.md`
3. 將它們作為 local workspace context 注入

這層完全不依賴 zero，也不需要搜尋。

### Phase 2 Retrieval

當 agent read 某個路徑時，可以模仿 opencode 的 directory-aware resolve 思路：

- 先讀 workspace root 的 `AGENTS.md`
- 如果未來需要更細粒度記憶，則沿目錄向上查找更近的 memory fragment

例如：

```txt
src/routes/admin/users.ts
```

未來可對應：

```txt
src/routes/AGENTS.md
src/routes/admin/AGENTS.md
```

但這是第二階段，不是第一版必要條件。

## Writing Rules

這一段直接借 opencode initialize 的精神。

workspace memory 的內容只應該寫：

- agent 容易猜錯的事
- repo-specific 的事
- 真的會影響執行或決策的事

不應該寫：

- generic programming advice
- 過度冗長的教學
- 不可驗證的猜測
- 其實只是 session chatter 的內容

### Suggested Rule

## Interaction Model

目前這一階段，memory 的主要互動其實應該很少。

第一版即使有 `/memory show`、`/memory apply` 這類 command，它們的定位也應該很明確：

- 用於 debug
- 用於 review
- 用於 power-user 控制

而不是：

- 當成主要互動入口
- 要求一般使用者每次都手動管理 memory

比較理想的演進路徑是：

### Stage 1 — Background working memory

- 自動生成 `SESSION_SUMMARY.md`
- 自動讀取 `AGENTS.md`
- 自動把 workspace context 注入 runtime
- 不要求使用者頻繁操作 memory command

### Stage 2 — Background capability

- memory 大部分時間在背景運作
- 使用者只在需要 review 或修正時才顯式碰它
- command 保留作為 fallback 與 debug surface

一句話：

> command 是過渡期工具；memory 本身才是產品能力。

每一行都應該回答：

> 如果沒有這行，agent 很可能會做錯、漏掉、或浪費時間嗎？

如果答案是否，就不要寫進 workspace memory。

也可以正式表達成：

> Only write memory when it prevents future mistakes, saves repeated discovery, or preserves a repo-specific constraint.

## Summary Format

這裡直接借 opencode compaction 的 anchored summary 結構，但改成適合 workspace trace。

建議每次 session 完成後輸出：

```md
## Goal
- [task summary]

## Constraints & Preferences
- [repo-specific constraints]

## Progress
### Done
- [completed work]

### In Progress
- [unfinished work]

### Blocked
- [blockers]

## Key Decisions
- [important decisions]

## Next Steps
- [what to do next]

## Critical Context
- [important facts, errors, gotchas]

## Relevant Files
- [path: why it matters]
```

和 opencode 差別是：

- opencode 用來壓 session context
- 這裡用來產生 workspace-usable artifact

第一版不需要額外出現：

- `Suggested Workspace Memory`
- `Suggested Workspace Procedure`
- `Suggested Zero Candidate`

## Progressive Rollout

## Stage 0 — Manual Local Memory

目標：

- 不做自動抽取
- 只建立最小 local memory artifact
- 手動維護 `AGENTS.md`

這一階段就已經有價值，因為它很接近 opencode 的 local instruction workflow。

### Deliverables

- `AGENTS.md`
- optional `SESSION_SUMMARY.md`
- basic load order
- 注入到 system prompt 的 local memory block

## V1 Non-Goals

為了避免第一版 scope 膨脹，下面這些都明確不做：

- `.zero/` 目錄
- `zero-api` runtime dependency
- vector search
- global memory
- automatic promotion
- candidate merge / versioning
- directory-aware `AGENTS.md`
- `CLAUDE.md` 相容層

## Stage 1 — Session Summary As Trace Material

目標：

- 每次 session 結束後產生固定格式 summary
- summary 寫進 `SESSION_SUMMARY.md`
- 暫時不自動 promote

這一階段相當於：

- 借用 opencode compaction 的摘要格式
- 但把輸出變成 workspace memory 原料

### Deliverables

- session summary generator
- summary writing policy
- future archive strategy if summary becomes too large

## Stage 2 — Zero Candidate Export

目標：

- 將已被接受或被多次提及的 local memory / procedure 匯出成 zero candidate

這一階段開始和 `zero-api` 接起來，但只接 candidate，不直接接 final global memory。

### Candidate Shape

建議最小欄位：

```json
{
  "source_workspace": "project-a",
  "source_trace": "trace-2026-05-13-001",
  "candidate_type": "procedure_candidate",
  "topic": "backend/api",
  "content": "...",
  "confidence": 0.72,
  "accepted_count": 1,
  "rejected_count": 0
}
```

## Stage 3 — Zero Promotion

目標：

- 由 zero 合併多個 workspace candidate
- 形成 reusable `procedure` / `correction` / `knowledge`

這才是 evolved zero memory。

## Zero Integration Contract

為了讓現在的 local memory 不會把未來綁死，第一版就應該保留一個乾淨的 export contract。

建議分成兩類：

### 1. Local Memory Artifact

repo 內可讀可改的 markdown：

- `AGENTS.md`
- `SESSION_SUMMARY.md`
- optional later:
  - `WORKSPACE_MEMORY.md`
  - `WORKSPACE_PROCEDURES.md`

### 2. Zero Export Payload

可送到 `zero-api` 的結構化資料：

- `workspace_fact`
- `procedure_candidate`
- `correction_candidate`
- `trace_summary`

這樣可以做到：

- 本地照樣可用
- 未來接 `zero-api` 不需要重寫整個 local layer
- 即使完全不接 `zero`，OpenZeroCode 仍然有完整的 workspace memory 能力

## How This Maps To Zero API

`zero-api` 現在已經有：

- typed memory
- context traces
- correction feedback
- correction / procedure promotion

所以最合理的串接方式不是讓 OpenZeroCode 一開始就直接依賴 `zero-api` 做 default memory，而是：

1. 先在 workspace 內產生 local artifacts
2. 再把這些 artifact 或 candidate 匯出到 `zero-api`
3. 由 `zero-api` 承接 typed storage / retrieval / promotion

也就是：

```txt
OpenZeroCode local memory
↓
candidate export
↓
zero-api typed memory / trace / promotion
↓
future zero evolution layer
```

## Recommended First Implementation In This Repo

如果要真的開始做，我建議順序如下：

### Step 1

沿用 `opencode` 風格，先只定義：

- `AGENTS.md`
- `SESSION_SUMMARY.md`

### Step 2

在 session 啟動時載入這兩個檔案，組成一個 local memory context block。

### Step 3

在 session 完成或 compact 時，產出一份固定格式 summary。

### Step 4

最後才設計：

- 是否拆出 `WORKSPACE_MEMORY.md` / `WORKSPACE_PROCEDURES.md`
- export-to-zero candidate pipeline

## Final Definition

如果要把這份設計濃縮成一句話：

> OpenZeroCode 的第一代 memory 會盡量模仿 opencode 的 local instruction 與 session summary 思路，先把 workspace-level 記憶做成可讀、可改、可注入的本地 artifact；之後再把這些 artifact 作為原料，接到 zero 的 typed memory 與 procedure evolution pipeline。

更短一點：

> 先做像 opencode 的 local memory，再讓 zero 從這些 local memory 裡學會跨 workspace 的智慧。

如果要再補上產品定位：

> OpenZeroCode 先獨立解決 workspace；zero 再持續學習 operator。
