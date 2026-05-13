# OpenZeroCode — Current UI Notes

本文件只描述目前 UI 已落地的互動、尚未完成的缺口，以及短期最建議的後續工作。

---

## Implemented

- 主入口為 `src/client/tui.tsx`
- 回應區使用 `scrollbox`
- response 目前已是 turn-oriented transcript group
- 滑鼠滾輪與 PgUp/PgDn 只影響回應區
- Escape 行為：
  - 有 draft 時清空輸入
  - 執行中且 draft 為空時中斷目前 run
- Up / Down 輸入歷史已實作，最多 100 筆
- Build / Plan mode 切換已實作
- provider / model command palette 已實作
- session list / rename / delete / compaction 已實作
- assistant response 即時串流
- `Thinking` 區塊即時串流
- reasoning / tool / error block 已可 collapse
- assistant response footer 已有第一版：
  - `provider/model`
  - copy hint
- selection copy 已實作
- `/exit` 與 `Ctrl+C` 會先 destroy renderer 再退出
- 執行中 spinner animation 已實作
- sidebar 已顯示 context、估算 cost、git diff summary

## Not Implemented Yet

- Smart auto-follow
- Paced streaming
- Diff view
- Response-scoped diff summary
- Rich tool-specific cards
- Copy affordance button
- Reasoning collapse / side panel

## Cautions

- `stickyScroll` 目前只能算部分解法，不能視為完整 auto-follow。
- 資料模型已支援 `parts`，但 tool / response meta 還沒有完整細分到 per-message UI。
- selection copy 已可用，但文案與視覺反饋仍可再調整。
- `memory` 目前已有 command-level control surface，但這應視為過渡期做法，不應成為長期主互動模型。

## Next Recommended UI Work

### P0 — Stability / Readability

- Tool output truncation
- Smart auto-follow

### P1 — Coding-Agent Clarity

- Response-scoped diff summary
- Rich tool-specific cards
- Per-message provider/model metadata

### P2 — Interaction Polish

- Paced streaming
- Copy affordance button
- Reasoning collapse / side panel
