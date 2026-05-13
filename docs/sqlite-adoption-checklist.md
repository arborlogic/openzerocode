# OpenZeroCode — SQLite Adoption Checklist

> **Status: ✅ 當前決定維持不變 — 仍以檔案式 storage 為主力。**

本文件定義：

- 為什麼 **現在** 不急著在 OpenZeroCode 導入 sqlite
- 什麼情況下值得導入 sqlite
- 導入後哪些資料仍然應該維持檔案形式
- 如果未來要加，第一版應該怎麼切

這份文件的目的是避免過早把 storage 複雜化。

---

## Current Decision（仍維持）

目前階段的結論是：

> **先把檔案式 workspace memory 做完整，不先導入 sqlite。**

原因不是 sqlite 不好，而是目前要驗證的是 **memory v1 的產品行為**，不是 storage scalability。

現在真正已經跑順的 loop 是：

1. ✅ session start 讀 `AGENTS.md`
2. ✅ session JSON 保存 messages + compaction summary
3. ✅ context 超過門檻自動 compact
4. ✅ auto-approve 與 permission rules 持久化

---

## What We Keep File-Based

即使未來導入 sqlite，下列資料也應該優先保留檔案形式：

### `AGENTS.md`

原因：

- 這是給人和 agent 一起讀的 workspace instruction artifact
- 需要容易 review
- 需要容易手改
- 需要能直接跟 repo 一起版本管理

### `SESSION_SUMMARY.md`

原因：

- 這是 handoff artifact，不是純 internal cache
- 需要能直接打開看
- 需要能直接修正
- 需要作為 local-first continuation 的 source

### Why This Matters

一句話：

> **檔案是使用者介面與真實來源；sqlite 只能是內部索引與查詢層。**

---

## What SQLite Would Be For

如果未來導入 sqlite，最合理的角色不是取代 `AGENTS.md` / `SESSION_SUMMARY.md`，而是補下面這些能力：

- local trace index
- structured candidate store
- accepted / rejected state tracking
- local queryable history
- internal dedupe / merge support
- response / session / tool metadata indexing

也就是：

> sqlite 應該先服務 **internal retrieval and bookkeeping**，不是先服務 human-facing memory artifacts。

---

## When To Add SQLite

只有在下列訊號開始出現時，才建議導入 sqlite。

### Signal 1 — Session history starts getting large

症狀：

- 想保留很多 session summary 歷史
- 需要查詢「某次做過什麼」
- 單靠 markdown 已經很難快速定位

判斷：

- 如果你開始需要按 task / file / date / session 查過去內容，sqlite 很可能值得加

### Signal 2 — Zero candidate lifecycle needs state

症狀：

- 需要追蹤某條 candidate 是否已接受
- 需要記 rejected / ignored / edited 狀態
- 需要知道一條 candidate 出現過幾次

判斷：

- 如果 zero 前置材料開始需要狀態機，sqlite 很適合

### Signal 3 — Local traces need structured querying

症狀：

- 需要查某個檔案近期被哪些 session 改過
- 需要查某類任務的成功 pattern
- 需要把 tool usage、diff、summary 關聯起來

判斷：

- 如果你開始需要 response/session/tool 三者的關聯查詢，就該考慮 sqlite

### Signal 4 — Accepted memory becomes too rich for plain append

症狀：

- `AGENTS.md` 已經不只是 instruction，而有多種結構化項目
- 想做分類、排序、來源追溯
- 想保留「原文 artifact」與「內部 normalized record」兩套視角

判斷：

- 如果 memory 開始長出 entity 與 metadata，sqlite 值得導入

### Signal 5 — Export to zero needs a stable local staging layer

症狀：

- 想把 accepted items、summary、trace 穩定地 export 到 zero
- 需要 retry / version / cursor / sync state

判斷：

- 如果 OpenZeroCode 開始擔任 zero 的 candidate staging source，sqlite 會很有幫助

---

## When Not To Add SQLite Yet

以下情況不應該成為導入 sqlite 的理由：

- 只是覺得 sqlite 比 markdown 專業
- 只是覺得未來可能用得到
- 只是想先把 schema 設計好
- 只是想模仿 opencode 的 storage 形狀

目前如果只是要做到：

- local-first memory
- summary handoff
- human-editable workspace artifacts

那檔案就足夠。

---

## Comparison With Opencode

`submodules/opencode` 現在的做法是：

- 核心資料主要進 sqlite
- 讀取時直接查 sqlite
- 寫入很多地方走 event/projector 路徑
- 另外保留少量本地檔案作為輔助 artifact

這樣的設計很適合：

- session / message / part 很多
- 需要同步與 projector
- 需要大量內部關聯查詢

但 OpenZeroCode 目前的 memory v1 還沒有進到這個複雜度。

所以現在最合理的借鏡不是「立刻用 sqlite」，而是：

- 學它的 local instruction mindset
- 學它的 anchored summary 思路
- 先不要學它完整的 storage complexity

---

## Recommended Path

### Stage 1 — File-based memory only

保留：

- `AGENTS.md`
- `SESSION_SUMMARY.md`

完成：

- loading
- summary generation

### Stage 2 — Optional lightweight local index

如果開始需要更多查詢能力，再考慮導入 sqlite，但只用於：

- session summary index
- zero candidate lifecycle
- trace metadata

此時：

- `AGENTS.md` 仍然是 human-facing instruction artifact
- `SESSION_SUMMARY.md` 仍然是 human-facing handoff artifact

### Stage 3 — Candidate staging for zero

當 local memory loop 成熟後，再考慮：

- local sqlite record
- export queue
- sync state
- candidate material for zero

這時 sqlite 才開始真正連到 zero pipeline。

---

## Minimal Rule

最簡單的決策規則是：

> **如果一個需求主要是讓人讀、讓人改、讓 repo 本地繼續工作，就先用檔案。**

> **如果一個需求主要是讓系統查、讓系統追蹤狀態、讓系統做結構化關聯，就考慮 sqlite。**

---

## Current Recommendation

截至目前為止，建議維持：

- workspace memory 用檔案
- summary 用檔案
- 不引入 sqlite dependency

等到出現以下至少兩個訊號，再重開 sqlite 評估：

1. 需要保留並查詢很多歷史 summary
2. 需要 zero candidate lifecycle state
3. 需要 trace / tool / response 的關聯查詢
4. 需要穩定 export 到 zero 的 staging layer

在那之前：

> **先把檔案式 memory 做好，比先把 sqlite 接進來更重要。**
