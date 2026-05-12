# OpenZeroCode — Response Redesign Roadmap

本文件記錄 `response` 區塊的對照研究、目標設計與分階段實作計畫。內容以目前專案與 `submodules/opencode` 已確認的程式碼為基礎，不把未驗證的想法寫成既定事實。

---

## Why This Exists

目前 `src/client/tui.tsx` 的 response 區塊已經能顯示：

- user / assistant / system 文字
- reasoning
- tool call
- tool result
- 串流中的 reasoning 與 assistant text

但整體仍偏薄，主要原因不是資料缺失，而是呈現模型過於扁平：

- 所有內容最後都被壓成 `DisplayBlock[]`
- 大部分 block 共用同一套視覺結構
- assistant response 缺少 footer / summary / change context
- 一輪對話的 user prompt、assistant parts、tool outputs 之間沒有被視覺性地綁在一起

這和 `submodules/opencode/packages/ui/src/components/session-turn.tsx` 與 `message-part.tsx` 的設計差異很大。

## Confirmed Current State

來源：

- `src/client/tui.tsx`
- `src/provider/types.ts`
- `src/provider/message-parts.ts`
- `src/client/stream-state.ts`

目前已確認：

- provider 層已支援 `parts`
  - `text`
  - `reasoning`
  - `tool-call`
  - `tool-result`
- session 載入時會把舊格式 message 補成 part-based message
- 串流狀態目前只有：
  - reasoning chunk 合併
  - assistant text chunk 合併
- response 區塊目前仍以 `blocks()` 將 `Message[]` 攤平成單一列表

## Opencode Reference Findings

來源：

- `submodules/opencode/packages/ui/src/components/session-turn.tsx`
- `submodules/opencode/packages/ui/src/components/message-part.tsx`

### 1. opencode 是 turn-oriented，不是 flat block list

`session-turn.tsx` 以「一輪對話」為主要顯示單位，會把同一輪裡的內容組在一起：

- user message
- assistant parts
- thinking / retry / working state
- diff summary

這讓回覆區塊天然具備節奏與關聯性。

### 2. opencode 是 part-specific renderer，不是 generic block renderer

`message-part.tsx` 會針對不同 part 做專用 UI：

- `text`
- `reasoning`
- `tool`
- `compaction`

而且不同 tool 還可以有自己的 `ToolRegistry.render(...)`。

### 3. opencode 有 assistant footer / meta

`text` part 末尾會顯示：

- agent
- model
- duration
- interrupted state
- copy response button

這讓 assistant 回覆看起來是完整回合，而不是單純一坨文字。

### 4. opencode 有清楚的 working / thinking 中間態

`session-turn.tsx` 會在 response 尚未完成時顯示：

- thinking shimmer
- reasoning heading reveal
- streaming markdown

因此使用者知道系統正在做什麼，而不是只看到一個正在增長的純文字區塊。

### 5. opencode 對 tool 結果做了高權重視覺化

`message-part.tsx` 中的 tool 呈現具備：

- pending / running / completed / error 狀態
- title / subtitle / args
- tool-specific card
- 某些 context tools 的聚合展示

這使工具呼叫成為 response 的重要組成，而不是附帶雜訊。

### 6. opencode 把 code changes 綁回該輪 response

`session-turn.tsx` 會在回覆完成後，直接展示：

- changed files count
- diff summary
- expandable diff content

目前 OpenZeroCode 的 diff 摘要在 `src/client/sidebar.tsx`，但不屬於任何特定 turn。

## Gap Analysis

相較之下，OpenZeroCode 目前最缺的不是顏色或 markdown，而是下面三層：

### A. 結構層

- 缺少 turn 概念
- 缺少 assistant response group
- 缺少 user prompt 與後續 tool / reasoning 的綁定

### B. 呈現層

- reasoning / tool-call / tool-result 沒有專門 renderer
- text part 沒有 footer
- streaming / thinking 中間態不夠明確

### C. 關聯層

- response 和 model/provider 沒有視覺關聯
- response 和 code change 沒有綁在一起
- response 和 copy action 沒有直接關聯

## Label Cleanup

已先完成一個最小修正：

- `src/client/tui.tsx`
- 純 `user` / `assistant` / `system` 文字區塊不再顯示 header
- 只保留有語義價值的 header：
  - `reasoning`
  - `tool-call`
  - `tool`
  - `error`
  - 或明確 `title`

這已經先解掉「`You Assist System` label 太多」的問題。

## Target Design

### Design Goals

- 把 response 從平面流水帳改成 turn-oriented transcript
- 強化 assistant 的「一輪完成感」
- 讓 reasoning、tool、text 的層次更清楚
- 保持目前 TUI 的簡潔，不直接複製 opencode 的整套 Web UI

### Target Response Hierarchy

每一輪預期會長成：

1. user prompt
2. assistant response group
3. optional reasoning section
4. optional tool activity section
5. optional footer/meta
6. optional change summary

### TUI-Specific Adaptation

OpenZeroCode 是 terminal UI，不適合直接照搬 opencode 的互動密度，因此需要做 TUI 化：

- 用「turn 分組 + 左側色條」建立結構
- 用「簡短 header + collapse」表達 reasoning / tool 狀態
- 用單行 footer 取代複雜 hover / tooltip
- 用簡潔 summary 取代完整 rich diff viewer

## Implementation Plan

### Phase 1 — Turn Skeleton

目標：把 `DisplayBlock[]` 改成 `DisplayTurn[]`。

內容：

- 依 `Message[]` 重建 turn
- user message 成為 turn 起點
- assistant / tool / system / streaming parts 併入同一輪 response 區塊
- scroll 區塊改 render turn，而不是 render flat blocks

完成後收益：

- transcript 的節奏會立即清楚很多
- 後續 footer / summary / diff 都有掛點

### Phase 2 — Part-Specific Blocks

目標：讓不同 part 類型不再共用完全相同的視覺結構。

內容：

- reasoning block
  - 預設可折疊
  - 使用較弱文字色
- tool-call block
  - 強化 tool 名稱
  - 顯示輸入內容
- tool-result block
  - 區分 success / error
  - 預設可折疊

完成後收益：

- assistant 主回答不會再被 tool 細節稀釋
- debug 能力仍保留

### Phase 3 — Assistant Footer

目標：補足 response 完成感。

第一版 footer 可先包含：

- provider
- model
- running / completed 狀態
- copy hint 或 copy affordance

限制：

- 目前訊息模型沒有 per-message provider/model metadata
- 第一版可能先使用 current session provider/model
- 若之後要更準確，需要在 message persistence 補欄位

### Phase 4 — Working / Thinking Polish

目標：讓串流中的狀態更可理解。

內容：

- thinking 中間態文案
- reasoning summary heading
- assistant text streaming 的節奏感改善

### Phase 5 — Response-Scoped Change Summary

目標：把 code changes 拉回該輪回覆。

內容：

- 顯示 changed files count
- 顯示簡短 diff stats
- 若實作成本可控，再提供展開內容

## Development Order

建議順序：

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5

原因：

- 先有 turn 結構，後面所有資訊才有正確掛點
- 先做 part-specific UI，assistant 主體就會立刻更清楚
- footer / thinking / diff 都是結構穩定後再補最划算

## Risks And Tradeoffs

### Risk 1 — 現有資料模型不含完整 message meta

影響：

- footer 第一版只能先顯示 session-level provider/model

對策：

- 先接受近似值
- 若後續需要精準性，再把 meta 寫進 assistant message

### Risk 2 — TUI 過度模仿 Web UI 會變得很吵

影響：

- 終端視覺密度很容易失控

對策：

- 保留 opencode 的資訊架構
- 不直接複製其所有互動細節

### Risk 3 — turn grouping 可能暴露舊訊息排序問題

影響：

- 若 assistant/tool message 順序不一致，grouping 會看起來怪

對策：

- 延用既有 `sanitizeMessages(...)`
- Phase 1 完成後用真實 session 測一輪 transcript

## Immediate Next Step

下一步直接進入 Phase 1：

- 調整 `src/client/tui.tsx`
- 建立 `DisplayTurn`
- 改用 turn-oriented render
- 保留目前已存在的 label cleanup
