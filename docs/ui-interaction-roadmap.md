# OpenZeroCode — UI 互動改善 Roadmap

根據 opencode `packages/app/src/` TUI 互動設計分析，整理短期可落地的改善項目。

---

## P0 — 立即能做（幾乎零成本）

### 1. Terminal resize 監聽

**問題：** 視窗縮放後版面會壞掉，`process.stdout.columns` 只在 render 時讀取，沒有監聽 resize 事件。

**解法：** 一行搞定。

```typescript
process.stdout.on("resize", () => screen.render())
```

`render()` 裡動態計算的所有 `cols` / `rows` 會自動更新。

---

### 2. Escape 多層行為（剝洋蔥）

**問題：** 現在 Escape 只關 palette，但使用者期望更直覺的行為。

**解法：** Escape 依狀態依序處理：

1. palette 開啟 → 關閉 palette
2. AI 正在執行 + 輸入框空白 → 中斷 AI（發送 AbortSignal）
3. 清空輸入框

```typescript
if (key.name === "escape") {
  if (this.paletteOpen) { this.closePalette(); return }
  if (this.mode === "prompt" && this.lines.join("").trim() === "" && isAiWorking) {
    this.abort.abort()
    return
  }
  this.lines = [""]; this.col = 0; this.row = 0
  this.screen.setDraft(this.lines)
  this.screen.setCursor(0, 0)
  return
}
```

Footer 動態提示：
```
// AI 執行中：
Esc interrupt  ·  Ctrl+P palette

// 閒置時：
Ctrl+P palette  ·  ↑↓ history  ·  PgUp/PgDn scroll
```

---

### 3. 智慧自動捲動（Smart Auto-scroll）

**問題：** 收到新訊息就強制 `scrollOffset = 0`，使用者向上翻閱歷史時被打斷。

**解法：** 只有在 AI 串流輸出中才自動跟隨底部，使用者手動往上捲就解除跟隨。

```typescript
private autoFollow = true

setStreamingActive(active: boolean) {
  if (active) this.autoFollow = true
  this.render()
}

scrollBy(delta: number) {
  if (delta < 0) this.autoFollow = false
  // ...
}

append(text: string) {
  this.logs.push(...)
  if (this.autoFollow) this.scrollOffset = 0
  this.render()
}
```

Footer 提示：`↑ scrolled  ·  PgDn to follow`

---

## P1 — 體驗感差距最大

### 4. 串流逐字顯示（Paced Text Rendering）

**問題：** 現在全部收完才一次顯示，缺乏即時回饋感。

**解法：** opencode 每 18ms 推進一個斷詞，製造真實打字感。

```typescript
private streamBuffer = ""
private streamTimer: NodeJS.Timeout | undefined
private streamDisplayed = ""

feedStreamChunk(chunk: string) {
  this.streamBuffer += chunk
  if (!this.streamTimer) this.flushStream()
}

private flushStream() {
  if (!this.streamBuffer) { this.streamTimer = undefined; return }
  const breakAt = this.nextBreak(this.streamBuffer)
  this.streamDisplayed += this.streamBuffer.slice(0, breakAt)
  this.streamBuffer = this.streamBuffer.slice(breakAt)
  this.render()
  this.streamTimer = setTimeout(() => this.flushStream(), 18)
}

private nextBreak(s: string): number {
  for (let i = 1; i < Math.min(s.length, 12); i++) {
    if (" \n\t.,;:!?".includes(s[i]!)) return i + 1
  }
  return Math.min(s.length, 8)
}

finalizeStream() {
  if (this.streamTimer) clearTimeout(this.streamTimer)
  this.streamDisplayed += this.streamBuffer
  this.streamBuffer = ""
  this.streamTimer = undefined
  this.render()
}
```

在最後一列加上 `▌` 游標。

---

### 5. 工具區塊折疊（Collapsible Tool Blocks）

**問題：** 工具完整輸出佔滿畫面，雜訊太多。

**解法：** 預設只顯示摘要 `◆ bash "ls src/" · 231ms`，按鍵展開完整輸出。

```typescript
interface ToolBlock {
  id: string
  name: string
  status: "running" | "done" | "error"
  summary: string
  output: string
  expanded: boolean
  elapsed?: number
}
```

折疊狀態：
```
  ◆ bash  "ls -la src/"  ·  231ms  [▸ expand]
```

展開狀態：
```
  ◆ bash  "ls -la src/"  ·  231ms  [▾ collapse]
  │  total 48
  │  drwxr-xr-x  cli.ts
```

鍵盤：`→` 展開，`←` 折疊，`e` 全部展開/折疊。

---

### 6. 輸入歷史 ↑↓（Input History）

**問題：** 所有 shell 用戶的肌肉記憶，現在缺這個功能。

**解法：** Up arrow 在游標位置 0 時瀏覽歷史，最多 100 條。

```typescript
private history: string[] = []
private historyIdx = -1
private historyDraft = ""

// up
if (key.name === "up" && this.row === 0 && this.col === 0) {
  if (this.historyIdx === -1) this.historyDraft = this.lines.join("\n")
  this.historyIdx = Math.min(this.historyIdx + 1, this.history.length - 1)
  const entry = this.history[this.historyIdx]
  if (entry) { this.lines = entry.split("\n"); this.col = this.lines[0]!.length }
  this.screen.setDraft(this.lines)
  return
}

// down
if (key.name === "down" && this.historyIdx >= 0) {
  this.historyIdx--
  const entry = this.historyIdx >= 0 ? this.history[this.historyIdx]! : this.historyDraft
  this.lines = entry.split("\n")
  this.col = this.lines[this.lines.length - 1]!.length
  this.screen.setDraft(this.lines)
  return
}

// 提交時記錄
private submitPrompt() {
  const value = this.lines.join("\n").trim()
  if (value) {
    this.history.unshift(value)
    if (this.history.length > 100) this.history.pop()
  }
  this.historyIdx = -1
  this.historyDraft = ""
}
```

---

## P2 — 精緻度

### 7. Diff 視圖

**問題：** 使用者想知道 AI 到底改了什麼。

**解法：** edit/write 工具完成後在折疊區塊內顯示 +/- 行。

```typescript
function renderDiff(before: string, after: string, filename: string): string {
  const lines: string[] = []
  lines.push(chalk.hex("#8B949E")(`--- ${filename} (before)`))
  lines.push(chalk.hex("#8B949E")(`+++ ${filename} (after)`))
  const bLines = before.split("\n")
  const aLines = after.split("\n")
  for (const line of computeDiff(bLines, aLines)) {
    if (line.type === "add")    lines.push(chalk.hex("#3FB950")("+ " + line.text))
    if (line.type === "remove") lines.push(chalk.hex("#F85149")("- " + line.text))
    if (line.type === "same")   lines.push(chalk.hex("#6B6B6B")("  " + line.text))
  }
  return lines.join("\n")
}
```

推薦套件：`diff`（pure JS，零依賴）。

---

### 8. Spinner 動畫

**問題：** 目前只有靜態 `●`，不夠生動。

**解法：** Frame-based spinner 替代靜態符號。

```typescript
const SPINNER_FRAMES = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"]
let spinnerFrame = 0

setInterval(() => {
  spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length
  this.render()
}, 80)
```

工具列顯示：
```
  ◆ bash  [⠹]  "npm install..."   ← 執行中
  ◆ bash  ✓  "npm install..."  ·  4.2s   ← 完成
  ◆ bash  ✗  "npm install..."  ·  error   ← 失敗
```

---

### 9. 訊息跳轉 `[` `]`

**問題：** 長對話時要手動捲動找 user message 很麻煩。

**解法：** `[` / `]` 跳到上一個/下一個 user message（類似 vim 段落跳轉）。

```typescript
if (key.name === "[" && !key.ctrl) {
  this.screen.jumpToPrevUserMessage()
  return
}
if (key.name === "]" && !key.ctrl) {
  this.screen.jumpToNextUserMessage()
  return
}
```

```typescript
jumpToPrevUserMessage() {
  const userLines = this.logs
    .map((l, i) => ({ i, isUser: stripAnsi(l).includes("you  ") }))
    .filter(x => x.isUser)
  // 設定 scrollOffset
}
```

---

## 優先順序總表

| 優先 | 項目 | 難度 | 體驗提升 | 成本 |
|------|------|------|----------|------|
| P0 | Terminal resize 監聽 | 極低 | 防止版面崩潰 | 1 行 |
| P0 | Escape 多層行為 | 低 | 直覺操作 | ~10 行 |
| P0 | 智慧自動捲動 | 低 | 翻閱歷史不被打斷 | ~15 行 |
| P1 | 串流逐字顯示 | 中 | 即時視覺回饋 | ~40 行 |
| P1 | 工具區塊折疊 | 中 | 畫面整潔度 | ~60 行 |
| P1 | 輸入歷史 ↑↓ | 低 | 避免重複輸入 | ~30 行 |
| P2 | Diff 視圖 | 中 | 清楚看見變更 | ~30 行 |
| P2 | Spinner 動畫 | 低 | 視覺細緻度 | ~10 行 |
| P2 | 訊息跳轉 `[` `]` | 低 | 長對話導航 | ~15 行 |

---

*參考來源：`submodules/opencode` — packages/app/src/components/, packages/app/src/lib/*
