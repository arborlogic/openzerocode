# OpenZeroCode — Current UI Notes

> **Status: ✅ 穩定版 — 此為 v1 已實作 UI 的記錄文件。**

本文件記錄目前 UI 已落地的互動、尚未實作的缺口，以及可考慮的後續工作。

---

## 已實作功能

### 核心 UI

- 主入口為 `src/client/tui.tsx`
- 回應區使用 `scrollbox`
- response 為 turn-oriented transcript group
- 滑鼠滾輪與 PgUp/PgDn 只影響回應區

### 輸入與操作

- Escape 行為：
  - 有 draft 時清空輸入
  - 執行中且 draft 為空時中斷目前 run
- Up / Down 輸入歷史已實作，最多 100 筆
- 執行中 spinner animation 已實作
- `/exit` 與 `Ctrl+C` 會先 destroy renderer 再退出

### 模式切換

- Build / Plan mode 切換已實作
- provider / model command palette 已實作

### Session 管理

- session list / rename / delete / compaction 已實作

### Response 呈現

- assistant response 即時串流
- `Thinking` 區塊即時串流
- reasoning / tool / error block 可 collapse
- assistant response footer：
  - `provider/model`
  - copy hint
- selection copy 已實作 (onMouseUp → renderer selection → clipboard)

### Sidebar

- 顯示 context、估算 cost、git diff summary

### Permission / Auto-Approve

- `/auto` 或 `/auto-approve` 指令切換 auto-approve 模式
- Palette 中顯示 Auto-approve toggle（ON/OFF）
- Auto-approve ON 時：
  - 唯讀工具（read/grep/glob/web-fetch）自動放行
  - write/edit 自動放行
  - 非 destructive bash 自動放行
  - destructive bash 仍跳出審批對話框
- Permission rules 可累積：每次 allow 後自動加入規則
- Auto-approve 狀態會保存至 session JSON

## 尚未實作

- Smart auto-follow（`stickyScroll` 是部分解法，非完整 auto-follow）
- Paced streaming
- Diff view
- Response-scoped diff summary
- Rich tool-specific cards
- Copy affordance button（目前只有 hint）
- Reasoning collapse / side panel

## 已驗證 (Test Coverage)

| 測試 | 檔案 |
|------|------|
| Autocomplete | `autocomplete.test.ts` |
| Commands | `commands.test.ts` |
| Errors | `errors.test.ts` |
| Markdown | `markdown.test.ts` |
| Permission rules | `permission-rules.test.ts` |

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
