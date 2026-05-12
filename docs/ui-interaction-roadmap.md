# OpenZeroCode — Current UI Notes

本文件只描述目前 UI 已落地的互動與明確尚未完成的缺口，不保留長篇提案式 roadmap。

---

## Implemented

- 主入口為 `src/client/tui.tsx`
- 回應區使用 `scrollbox`
- 滑鼠滾輪與 PgUp/PgDn 只影響回應區
- Escape 行為：
  - 有 draft 時清空輸入
  - 執行中且 draft 為空時中斷目前 run
- Up / Down 輸入歷史已實作，最多 100 筆
- Build / Plan mode 切換已實作
- assistant response 即時串流
- `Thinking` 區塊即時串流，並維持在 answer 前方
- selection copy 已實作，右上角顯示 `Copy`
- `/exit` 與 `Ctrl+C` 會先 destroy renderer 再退出
- tool output 已有基本卡片樣式

## Not Implemented Yet

- Smart auto-follow
- Tool block collapse / expand
- Paced streaming
- Diff view
- Spinner animation
- Copy toast polish
- Reasoning collapse / side panel

## Cautions

- `stickyScroll` 目前只能算部分解法，不能視為完整 auto-follow。
- `Thinking` 已可用，但資料模型本身仍不是 part-based。
- selection copy 已可用，但文案與視覺反饋仍可再調整。
