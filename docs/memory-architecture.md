# OpenZeroCode / Zero — Memory Architecture

本文件整理目前對 memory 架構的設計方向，並對照：

- `submodules/opencode` 的現況
- `../zero-api` 的現況

目標不是只描述「記憶要存在哪裡」，而是明確區分：

- workspace memory
- extracted memory
- evolved zero memory

並定義 zero 的真正角色。

---

## One-Line Definition

> workspace memory 記錄「這裡怎麼做」；zero memory 萃取「通常怎麼做會成功」。

也可以寫成：

> Workspace memory records what happened here.  
> Zero memory learns what tends to work across workspaces.

再更產品化一點：

> zero is not memory storage; zero is a memory evolution engine.

## Core Positioning

default memory 不應該一開始就做成全域、抽象、黑盒。

default memory 應該永遠貼近當前 workspace 本身：

- local-first
- 可讀
- 可改
- 人可以直接審查
- 不需要先依賴 zero 才存在

所以最穩的定義是：

> workspace memory 是原始工作現場記憶；zero 是從這些 workspace memory 裡萃取、壓縮、演化出來的長期智慧層。

另外還有一個必須固定下來的產品原則：

> OpenZeroCode 本身就應該像 opencode 一樣完整可用；zero 不是基礎依賴，而是額外補上屬於 operator 的長期習慣、慣例、判斷偏好與思維規範。

也就是說：

- `openzerocode` 沒有 `zero` 也必須能正常工作
- `zero` 是 optional enhancement，不是 foundational dependency
- workspace memory 屬於工作現場
- zero memory 屬於 operator

可以再濃縮成兩句：

> OpenZeroCode solves the workspace.  
> Zero learns the operator.

## The Three Levels

## Level 1 — Workspace Memory

這是最原始、最具體的記憶層。

在目前這個階段，workspace memory **不需要為 zero 發明特殊目錄**。

比較合適的做法是直接沿用 `opencode` 的 instruction-first 風格：

- 先以 `AGENTS.md` 為主
- 視相容需求再考慮 `CLAUDE.md`
- 必要時再補很中性的 workspace 文件

第一版最小可行版本可以只有：

```txt
project-a/
  AGENTS.md
  SESSION_SUMMARY.md
```

其中：

- `AGENTS.md` 承接 instruction 與高訊號 workspace facts
- `SESSION_SUMMARY.md` 承接單份最新的 anchored summary / handoff

如果未來 `AGENTS.md` 過長，或 procedure 真的長出穩定內容，再拆出中性文件：

- `WORKSPACE_MEMORY.md`
- `WORKSPACE_PROCEDURES.md`

例子可以先長成：

```md
# AGENTS.md

- This repo uses pnpm.
- Do not modify generated files.
- API routes are under /src/routes.
- Tests should be run with `pnpm test`.
- Deployment uses Cloudflare Workers.
```

這層記錄的是：

- 這個 repo 怎麼跑
- 這個 repo 的規則
- 這個 repo 的常用 command
- 這個 repo 裡已知會踩雷的地方

`AGENTS.md` 的角色應該明確收斂成：

> stable, high-signal, execution-critical workspace instructions

也就是只放：

- 執行前必須知道
- 穩定
- repo-specific
- agent 很容易猜錯

不應該放：

- 未確認推測
- 一次性的工作過程
- 過長的交接紀錄
- 聊天式 session 細節

### Traits

- local-first
- human-readable
- human-editable
- repository-bound
- 不一定要同步進 zero

### Purpose

AI 進入這個 workspace 時，不需要重新認識整個專案。

也就是：

> default memory = workspace memory

## Level 2 — Extracted Memory

這層不是最終知識，而是 zero 從 workspace memory / trace / correction 中萃取出來的候選知識。

例如：

```json
{
  "type": "procedure_candidate",
  "source": "workspace_trace",
  "confidence": 0.82,
  "content": {
    "name": "Add Fastify API endpoint",
    "steps": [
      "Find route registration",
      "Check schema validation",
      "Add handler",
      "Add test",
      "Run pnpm test"
    ]
  }
}
```

它的定位是：

- 還不一定正確
- 還沒完成去重
- 還沒跨 workspace 驗證
- 但已經比 raw trace 更結構化

### Traits

- structured
- candidate-oriented
- confidence-based
- 可累積 accepted / rejected signal

## Level 3 — Evolved Zero Memory

這層才是 zero 的長期護城河。

它來自：

- 多個 workspace memory
- 多個 trace
- 多個 correction
- 多次成功 outcome

最後形成：

- 跨 workspace procedure
- 使用者偏好
- 常見錯誤模式
- decision memory
- model routing / capability memory
- 高成功率操作流程

這層不再是單一 repo 的事實，而是跨 workspace 可重用的長期智慧。

## Why This Split Matters

如果一開始就把所有工作記憶都塞進全域 memory，會很快污染掉 zero。

例如：

- 專案 A 使用 `pnpm`
- 專案 B 使用 `npm`
- 專案 C 使用 `bun`

這些不能直接變成全域規則。

zero 應該萃取的是更抽象、可重用的 pattern：

```txt
Before running install/test commands, inspect package manager lockfile.
```

不是：

```txt
Always use pnpm.
```

所以正確分工是：

- workspace memory 保留具體事實
- zero memory 只保留更穩定的抽象模式

這也保證了另一件重要的事：

- 沒有 zero 時，OpenZeroCode 仍然是一個完整可用的 coding agent
- 有 zero 時，補上的不是基礎能力，而是 operator-level 的長期歸納能力

## Data Flow

建議的完整資料流：

```txt
workspace session
↓
trace
↓
workspace memory update
↓
zero extraction job
↓
procedure candidate
↓
validation / merge / versioning
↓
zero evolved memory
↓
下次進入 workspace 時再注入
```

更具體一點：

```txt
agent 執行任務
↓
產生 session trace
↓
使用者修正或 approve
↓
更新 AGENTS.md / SESSION_SUMMARY.md
↓
zero 定期萃取
↓
產生 candidate
↓
多次驗證成功後升級成 zero procedure
```

## Comparison With Opencode

`submodules/opencode` 現在最成熟的不是 long-term memory，而是：

- workspace instruction resolution
- session persistence
- session compaction
- single-session runtime orchestration

### What Opencode Already Has

最接近 workspace memory 的是 instruction system：

- 全域 `AGENTS.md`
- 專案層 `AGENTS.md` / `CLAUDE.md`
- 讀檔後沿目錄向上解析附近 instruction 檔案

參考：

- [instruction.ts](/Users/masato/Dev/ai-util/openzerocode/submodules/opencode/packages/opencode/src/session/instruction.ts:1)

此外它有很成熟的 session compaction：

- anchored summary
- overflow detection
- pruning
- tail turn preservation

參考：

- [compaction.ts](/Users/masato/Dev/ai-util/openzerocode/submodules/opencode/packages/opencode/src/session/compaction.ts:1)

### What Opencode Does Not Really Have

如果用本文件的三層來看，opencode 目前缺的是：

- 明確的 workspace-local memory artifact layer
- extracted memory candidate lifecycle
- correction → reusable procedure promotion pipeline
- cross-workspace evolved memory

所以 opencode 比較像：

- 很強的 workspace/session runtime
- 不是 memory evolution engine

### Mapping

| Level | opencode 現況 |
|---|---|
| Workspace Memory | 部分有，但以 instruction files 表現，不是顯式 memory layer |
| Extracted Memory | 幾乎沒有 |
| Evolved Zero Memory | 沒有 |

## Comparison With Zero API

`../zero-api` 目前比 opencode 更接近 zero memory 的核心，因為它已經有：

- typed memory
- memory retrieval
- context builder
- context traces
- correction feedback
- correction / procedure promotion

參考：

- [service/memory/service.go](/Users/masato/Dev/ai-util/zero-api/service/memory/service.go:1)
- [service/context/builder.go](/Users/masato/Dev/ai-util/zero-api/service/context/builder.go:1)
- [handler/feedback.go](/Users/masato/Dev/ai-util/zero-api/handler/feedback.go:1)
- [model/correction_feedback.go](/Users/masato/Dev/ai-util/zero-api/model/correction_feedback.go:1)
- [model/memory.go](/Users/masato/Dev/ai-util/zero-api/model/memory.go:1)

### What Zero API Already Has

目前支援的 typed memory 包含：

- `note`
- `daily`
- `document`
- `knowledge`
- `procedure`
- `correction`
- `error`

chat 前的流程是：

1. 從 messages 組 query
2. 搜 memory
3. fallback query
4. 去重排序
5. 組 context block
6. 注入 system message
7. persist context trace

另外它也已經支援：

- correction feedback 記錄
- promote 成 `correction` memory
- promote 成 `procedure` memory

### What Zero API Is Still Missing

雖然 `zero-api` 已經有比較像 Level 2 / Level 3 的東西，但它仍少了很重要的 Level 1 substrate：

- workspace-local memory files
- human-editable raw workspace memory
- workspace-first memory ownership
- candidate merge / validation / versioning 流程
- 真正的 cross-workspace evolution loop

也就是說：

- `zero-api` 已經有比較像 zero memory 的 runtime
- 但還沒有把 workspace memory 定義成原料層

### Mapping

| Level | zero-api 現況 |
|---|---|
| Workspace Memory | 幾乎沒有明確本地檔案層 |
| Extracted Memory | 已有 typed memory / trace / correction promotion 雛形 |
| Evolved Zero Memory | 部分概念存在，但還沒有完整演化流程 |

## Synthesis

三邊的關係可以總結成：

- `opencode` 已經有成熟的 workspace/session runtime
- `zero-api` 已經有 typed retrieval memory 與 promotion 機制
- 本文件定義的是兩者之間還缺的完整記憶分層與進化路徑

更直接一點：

- opencode 強在互動 runtime
- zero-api 強在 typed memory runtime
- zero 應該強在 memory evolution

## Current First-Step Recommendation

如果只看目前這個階段，最小且最穩的落點是：

1. 沿用 `opencode` 的 instruction-first 做法
2. 先以 `AGENTS.md` 作為主要 workspace memory 載體
3. 再加一份 `SESSION_SUMMARY.md` 作為最近工作延續摘要
4. 暫時不要為 zero 發明特殊目錄或特殊檔名
5. 等內容真的長出來，再考慮拆成：
   - `WORKSPACE_MEMORY.md`
   - `WORKSPACE_PROCEDURES.md`

## MVP Recommendation

第一版不要直接做全自動抽取。

先做最小可行版本：

### Step 1

每個 workspace 建立或讀取：

```txt
AGENTS.md
SESSION_SUMMARY.md
```

### Step 2

session 開始時：

- 讀 `AGENTS.md`
- 讀 `SESSION_SUMMARY.md`
- 組成 local workspace context block
- 注入 agent / runtime

### Step 3

每次 session 結束後產生或重寫 `SESSION_SUMMARY.md`，例如：

```md
## Goal
- Add login API

## Progress
### Done
- Added route and handler.

### In Progress
- Add integration tests.

## Relevant Files
- src/routes/auth.ts
- src/handlers/login.ts

## Commands
- pnpm test

## Critical Context
- The agent initially used npm, but this repo uses pnpm.

## Suggested Workspace Memory
- This repo uses pnpm. Do not use npm.

## Suggested Workspace Procedure
- Before running commands, inspect lockfile to determine package manager.
```

### Step 4

讓使用者可以選擇：

- Accept into `AGENTS.md`
- Ignore

### Step 5

只有在 local workflow 穩定後，才考慮 export 給 zero。

例如未來的 export payload 可以是：

```txt
zero_candidates
- source_workspace
- source_trace
- candidate_type
- content
- confidence
- accepted_count
- rejected_count
```

這些不是 v1 必做項目。

## Product Definition

如果要把這個方向收斂成一句話，我建議定義成：

> 每個 workspace 保留自己的 default memory；zero 不直接取代它，而是持續從 workspace memory、trace、修正紀錄中萃取共通模式，逐步形成跨 workspace 可重用的 procedure 與 decision memory。

更短一點：

> workspace memory 是經驗原料，zero 是經驗萃取與進化層。

## Immediate Implications For This Repo

對 OpenZeroCode 目前最合理的下一步不是先做重型 global memory，而是：

1. 定義 `AGENTS.md` / `SESSION_SUMMARY.md` 的 workspace memory 結構
2. 把 session summary 轉成 workspace-level handoff
3. 定義 suggested memory / procedure schema
4. 之後再接到 `zero-api` 的 typed memory / promotion runtime

這樣責任會很清楚：

- workspace 負責真實經驗
- zero-api 負責 retrieval / trace / promotion
- zero 負責跨 workspace 的萃取、驗證、合併、進化
