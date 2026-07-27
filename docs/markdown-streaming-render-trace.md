# TUI Markdown 串流渲染 Trace 報告與閃爍修復

> 建立日期：2026-07-26
> 狀態：已修復（待使用者實機驗證）
> 相關檔案：`src/client/markdown-with-diff.tsx`、`src/client/streaming-markdown-blocks.ts`、`src/client/stream-state.ts`、`src/client/session-runner.ts`、`src/client/response-entry.tsx`
> 關鍵依賴：`@opentui/core@0.4.5`、`@opentui/solid@0.4.5`、`marked@^17.0.5`

---

## 目錄

1. [問題描述](#1-問題描述)
2. [渲染管線全覽](#2-渲染管線全覽)
3. [OpenTUI 內部機制 Trace](#3-opentui-內部機制-trace)
4. [根本原因分析](#4-根本原因分析)
5. [嘗試過的方案與失敗原因](#5-嘗試過的方案與失敗原因)
6. [最終修復方案](#6-最終修復方案)
7. [驗證結果](#7-驗證結果)
8. [後續追蹤事項](#8-後續追蹤事項)
9. [附錄：關鍵原始碼摘錄](#9-附錄關鍵原始碼摘錄)

---

## 1. 問題描述

Assistant 回應串流時，TUI 畫面上的 markdown 渲染出現**肉眼可見的閃爍**：

- 段落邊界處（blank line）特別明顯：舊段落會「閃現」一次後消失。
- 越長的回應、越快的串流，閃爍越頻繁。
- 使用者原始描述：「看起來是一直 render 太頻繁的感覺」。

---

## 2. 渲染管線全覽

資料流從 provider 到底層渲染器的完整路徑：

```
provider stream
  → assistant_stream_chunk（每個 SSE chunk，非常頻繁）
  → SessionRunner.handleAssistantStreamChunk()
      → appendChunk()          累積到 buffer
      → scheduleFlush()        32ms 後才 flush（FLUSH_INTERVAL_MS = 32）
      → ui.scrollBottom()      ⚠ 每個 chunk 都同步呼叫（不等 flush）
  → StreamState.flush()
      → setParts / setText()   寫入 Solid signal
  → ResponseEntry props.entry.text（signal 更新）
  → MarkdownWithDiff content={...}
  → OpenTUI <markdown> element（MarkdownRenderable）
  → parseMarkdownIncremental（marked.lexer 重新 lex + 增量 token 比對）
  → CodeRenderable 子樹（每個 block 一個，textBuffer 裝文字）
  → TextBufferRenderable.renderSelf() → frame buffer → 終端
```

### 各層的更新頻率

| 層 | 更新頻率 | 說明 |
|---|---|---|
| SSE chunk 到達 | 每 token / 每幾十 ms | 由 provider 決定 |
| `setText()` signal 更新 | 32ms 一次 | `FLUSH_INTERVAL_MS = 32`（`stream-state.ts:16`） |
| Solid reactive → `node.content = value` | 32ms 一次 | `@opentui/solid` setProperty 明確處理 content 屬性 |
| `parseMarkdownIncremental` | 每次 content 變更 | 即 32ms 一次，重新 lex 全部文字 |
| `requestRender()` → 實際繪製 | 由 OpenTUI 渲染迴圈合併 | 多次 requestRender 可能合併為一次繪製 |

**結論**：32ms throttle 本身已合理，問題不在「更新頻率」，而在**更新時 renderable 子樹被摧毀重建**。

---

## 3. OpenTUI 內部機制 Trace

以下為 `node_modules/@opentui/core/renderable/Markdown.ts` 的實際行為。

### 3.1 兩種 block 模式

```
internalBlockMode: "nested" | "top-level"
```

- **nested**：一個巢狀容器樹，每個 block 有自己的 padding/margin，結構變更時整棵樹調整。
- **top-level**：扁平列表，每個 block 是獨立的 `BlockRenderable`，子樹變更時只影響受影響的 block。

OpenTUI 官方建議：**串流場景使用 `top-level`**，因為 nested 模式在任何 block 高度變化時會觸發後續所有 block 的佈局重算。

### 3.2 增量解析：`parseMarkdownIncremental`

每次 `content` 變更時觸發：

```typescript
// Markdown.ts (0.4.5)
private parseMarkdownIncremental(content: string, filetype: string | undefined, conceal: boolean, renderUnstyledTokens: boolean) {
  // 1. 全部重新 lex（marked.lexer 是純函數，無法增量）
  // 2. 取得 previousTokenState（上次解析的快照）
  // 3. findIncrementalReuseRange：
  //    從尾部往回找「穩定區段」——token type + raw 完全相同的連續區段
  //    trailingUnstableBlocks = 2（固定）：最後 2 個 block 永遠視為不穩定
  // 4. 重用 stable 區段的 MarkdownTokenRef（保留 renderable 參考）
  // 5. 只對 unstable / 新增的 token 建立新的 MarkdownTokenRef
}
```

**關鍵**：`trailingUnstableBlocks = 2` 表示每次更新時，最後 2 個 top-level block 的 renderable 一定會被摧毀重建。

### 3.3 streaming flag 的雙重作用

`streaming: boolean` 在 `MarkdownRenderable` 中有兩個獨立作用：

**作用 A — 控制初始渲染路徑**（`createInitialStyledText`）：

```typescript
// 當 streaming=true：先產生 plain-text StyledText，立即寫入 textBuffer
// 當 streaming=false：回傳 undefined，textBuffer 保持空值，等 async highlight 完成
```

**作用 B — 控制 code fence 渲染策略**（`applyMarkdownCodeRenderable`）：

```typescript
// streaming=true：CodeRenderable.streaming = true → textBuffer.setText() 立即同步
// streaming=false：CodeRenderable.streaming = false → 等 tree-sitter async highlight
```

### 3.4 CodeRenderable 的 two-phase 渲染

```typescript
// CodeRenderable.content setter（0.4.5）
set content(value: string) {
  this._content = value
  if (this._streaming && this._filetype && !this._drawUnstyledText) {
    this.requestRender()   // ⚠ 只觸發重繪，textBuffer 不更新！
    return
  }
  // 否則：textBuffer.setText(this._content) 同步更新
}
```

當 `streaming=false` 且有 filetype 時：
1. `content` 變更 → `requestRender()` → 渲染迴圈用**舊 textBuffer** 繪製一次（顯示舊文字）
2. 同時觸發 async tree-sitter highlight
3. highlight 完成 → textBuffer 更新 → 再繪製一次（顯示新文字）

這個「先顯示舊文字、再跳成新文字」的 two-phase 過程，就是 code block 閃爍的來源之一。

---

## 4. 根本原因分析

### 4.1 原始（有問題的）設計

`MarkdownWithDiff`（修復前）將串流內容用 `partitionStreamingMarkdown` 分割成兩部分：

```
completed[]（已完成的 block）→ 各自的 <markdown streaming={false}>
pending（最後一個未完成的 block）→ 另一個 <markdown streaming={false}>
```

`partitionStreamingMarkdown` 以 blank line 為邊界，最後一個 group 在串流中永遠是 pending。

### 4.2 閃爍觸發鏈

**時間點 T**：pending 包含「段落 A 的部分文字」
**時間點 T+32ms**：段落 A 完成（遇到 blank line），partition 結果改變：

```
T 時：   completed = [...], pending = "段落 A 部分文字"
T+32ms： completed = [..., "段落 A 完整"], pending = ""（或新段落開頭）
```

此時發生兩件事：

**事件 1：pending `<markdown>` 的 content 完全改變**
- 舊 content：「段落 A 部分文字」
- 新 content：「"" 或 新段落開頭」
- 兩者沒有共同 raw prefix → `findIncrementalReuseRange` 找不到可重用區段
- pending 的 `MarkdownRenderable` 子樹全部摧毀重建
- 若 pending 是 code block → 走 3.4 的 two-phase 路徑 → 閃爍

**事件 2：completed 新增一個 `<markdown>` 元素**
- Solid `Index` 的 key 是 index，「段落 A 完整」插到 completed 陣列尾端
- 若 completed 是 `Index` 且新增一個元素 → 新 `MarkdownRenderable` 從零建立
- 新建立的 renderable 需要 async highlight → 短暫顯示空白或舊文字

**事件 3（疊加效應）**：
- 段落 A 在「舊 pending」消失與「新 completed」出現之間，有一幀同時存在於兩處
- 視覺上：段落 A 先出現兩次、再變成一次 → 閃爍

### 4.3 為什麼 `streaming={false}` 是核心問題

原始設計中，所有 `<markdown>`（包括 pending）都設 `streaming={false}`：

- `createInitialStyledText` 回傳 `undefined`
- `drawUnstyledText = (initialStyledText !== undefined) = false`
- CodeRenderable 走 two-phase 路徑（3.4）
- 每次 block 新增/更新都要等 async highlight 才能顯示正確文字

---

## 5. 嘗試過的方案與失敗原因

### 方案 A（已被使用者拒絕）

**做法**：串流期間改為單一 `<markdown streaming={true} internalBlockMode="top-level">`，串流完成後切換到 `FinalizedMarkdownWithDiff`。

**失敗原因**（使用者回饋：「render 不完整 + 閃爍沒解決」）：

1. **render 不完整**：串流結束時從 streaming 版本切換到 `FinalizedMarkdownWithDiff`，兩個不同的元件在 `<Show keyed>` 下交替，若切換時機剛好在 flush 前後，部分內容可能遺失或閃現空白。
2. **閃爍持續**：`<Show keyed>` 在 `streaming` flag 翻轉時摧毀 streaming `<markdown>` 元素、建立 finalized 版本，這個元件替換本身就是一次大閃爍。
3. **根本問題未解決**：方案 A 只換了分割策略，沒有解決「段落邊界處 renderable 被摧毀重建」的問題。

**教訓**：不能用「串流中一個元件、完成後另一個元件」的策略；streaming flag 的翻轉不能導致元素摧毀。

---

## 6. 最終修復方案

### 6.1 核心原則

1. **永遠只有一個 `<markdown>` 元素**：streaming flag 只是該元素的屬性，翻轉時元素不摧毀（OpenTUI 的 `streaming` setter 會就地 re-parse）。
2. **`<Show>` 的 key 只依賴內容結構**（`hasCustomSegments`），不依賴 `streaming` 狀態，確保 streaming→done 轉換不觸發元素替換。
3. **串流期間 `streaming={true}`**：讓 `createInitialStyledText` 立即產生 StyledText，textBuffer 同步更新，消除 two-phase 閃爍。

### 6.2 修改後的程式碼結構

```tsx
// markdown-with-diff.tsx（修改後）
export function MarkdownWithDiff(props: MarkdownWithDiffProps) {
  const segments = createMemo(() =>
    props.streaming ? [] : parseDiffBlocks(props.content, false)
  )
  const hasCustomSegments = createMemo(() =>
    requiresCustomMarkdownRenderer(segments())
  )

  return (
    <Show
      when={hasCustomSegments()}
      fallback={
        // 唯一的路徑：串流中 + 無 diff/table 的完成內容
        <markdown
          content={props.content}
          conceal={true}
          syntaxStyle={getMarkdownSyntaxStyle()}
          streaming={props.streaming ?? false}   // ← streaming flag 就地翻轉
          internalBlockMode="top-level"            // ← top-level 減少佈局重算
        />
      }
    >
      {/* 只有含 diff/table 才進入這個分支（串流中永遠不會進入） */}
      <Index each={segments()}>
        {(segment) => (
          <Switch>
            <Match when={segment().type === "diff"}>...</Match>
            <Match when={segment().type === "table"}>...</Match>
            <Match when={true}>
              <markdown
                content={segment().raw}
                conceal={true}
                syntaxStyle={getMarkdownSyntaxStyle()}
                streaming={false}
                internalBlockMode="top-level"
              />
            </Match>
          </Switch>
        )}
      </Index>
    </Show>
  )
}
```

### 6.3 各修復點對應的根因

| 修改 | 對應根因 |
|---|---|
| 串流中走單一 `<markdown streaming={true}>` | 消除 4.2 事件 1（pending 元素摧毀重建） |
| `streaming={true}` | 消除 4.3（two-phase 閃爍）：`createInitialStyledText` 回傳 StyledText，textBuffer 同步更新 |
| `internalBlockMode="top-level"` | 減少 nested 模式下的佈局重算範圍 |
| `<Show>` key 只用 `hasCustomSegments()` | 消除方案 A 的失敗點：streaming flag 翻轉不摧毀元素 |
| 串流結束後 `streaming` 就地翻轉 | OpenTUI `streaming` setter 就地 re-parse，元素保留，只觸發一次 updateBlocks |

---

## 7. 驗證結果

### 自動化驗證（已完成）

| 驗證項目 | 結果 |
|---|---|
| `bun run typecheck` | ✅ 通過 |
| `bun test src/client/markdown-with-diff.test.ts` | ✅ 18/18 通過 |
| `bun run build` | ✅ 成功 |
| 既有測試失敗（env-sensitive，與此修改無關） | `sessions.test.ts` ×2、`skill-loader.test.ts` ×2（stash 後重現，確認 pre-existing） |

### 待人工驗證

需要互動終端 + 實際 LLM provider，無法在此環境完成：

- [ ] 長回應串流時，段落邊界處無閃爍
- [ ] code block 串流時無 two-phase 閃爍
- [ ] 串流結束後內容完整（無截斷、無遺失）
- [ ] 含 diff block 的回應正確渲染（diff 高亮正常）
- [ ] 含 table 的回應正確渲染

---

## 8. 後續追蹤事項

### 若閃爍仍存在

依序排查以下方向：

1. **`scrollBottom()` 時機問題**（最可疑）
   - `session-runner.ts` 在每個 SSE chunk 同步呼叫 `ui.scrollBottom()`
   - 但內容實際在 32ms 後才 flush 到 signal
   - 結果：scroll 位置基於舊高度，paint 時內容已變 → 視覺抖動
   - 檔案：`src/client/session-runner.ts`、`src/client/tui.tsx`

2. **`ResponseEntry` 的 `<Show keyed>` remount**
   - `response-entry.tsx` 用 `responseEntryRenderKey` 作為 keyed Show 的 key
   - 若 key 在串流中改變 → 整個 entry 重新 mount → 大閃爍
   - 需確認 `responseEntryRenderKey` 在串流期間是否穩定

3. **`FLUSH_INTERVAL_MS = 32` 是否合適**
   - 32ms ≈ 31fps，理論上足夠
   - 但若 OpenTUI 渲染迴圈與 flush 時間點不對齊，可能造成 frame tearing
   - 可嘗試改為 16ms 或 50ms 觀察差異

4. **OpenTUI `trailingUnstableBlocks = 2` 的影響**
   - 每次 content 更新，最後 2 個 block 的 renderable 仍會重建
   - 對純文字段落影響小（textBuffer 同步更新）
   - 對 code block 影響大（two-phase 路徑）
   - 若 code block 閃爍仍嚴重，可考慮向 OpenTUI 提 issue 或 patch

### 長期改善方向

- **上游回報**：OpenTUI 的 `trailingUnstableBlocks = 2` 是寫死的常數，若能改為可配置，可進一步減少不必要的 renderable 重建。
- **marked lexer 快取**：目前每次 content 變更都重新 lex 全部文字，若內容很長（>10KB）會有效能問題；可考慮在應用層快取已穩定的 token 區段。
- **scrollBottom 節流**：將 `ui.scrollBottom()` 的呼叫時機改為 flush 之後，或加 throttle。

---

## 9. 附錄：關鍵原始碼摘錄

### 9.1 `parseMarkdownIncremental`（OpenTUI 0.4.5）

```typescript
// node_modules/@opentui/core/renderable/Markdown.ts
private parseMarkdownIncremental(
  content: string,
  filetype: string | undefined,
  conceal: boolean,
  renderUnstyledTokens: boolean
) {
  // 每次 content 變更都重新 lex 全部內容
  const tokens = this.lexer(content)
  const previous = this.previousTokenState

  // 從尾部找穩定區段（trailingUnstableBlocks = 2 固定）
  const { reusableStartIndex, reusableEndIndex } =
    findIncrementalReuseRange(previous.tokens, tokens, /* trailingUnstableBlocks */ 2)

  // 重用穩定區段的 MarkdownTokenRef（保留 renderable）
  // 只對不穩定 / 新增的 token 建立新 ref
}
```

### 9.2 `CodeRenderable.content` setter（OpenTUI 0.4.5）

```typescript
set content(value: string) {
  this._content = value
  if (this._streaming && this._filetype && !this._drawUnstyledText) {
    this.requestRender()   // ⚠ 不更新 textBuffer，等 async highlight
    return
  }
  this.textBuffer.setText(this._content)  // 同步更新
  this.requestRender()
}
```

### 9.3 `partitionStreamingMarkdown`（應用層）

```typescript
// src/client/streaming-markdown-blocks.ts
export function partitionStreamingMarkdown(source: string, streaming: boolean) {
  const tokens = marked.lexer(source)
  // 以 blank line 分割 block group
  // streaming=true 時，最後一個 group 永遠是 pending
  // 串流中遇到 reference-link definition 時，整份文件保持完整（不切分）
}
```

### 9.4 `MarkdownWithDiff` 修改前後對照

```
修改前：
  streaming 中 → partition 成 completed[] + pending
                 completed 各自 <markdown streaming={false}>
                 pending 一個 <markdown streaming={false}>
  → 段落邊界：pending 元素內容完全改變 → renderable 摧毀重建 → 閃爍

修改後：
  streaming 中 → 單一 <markdown streaming={true} internalBlockMode="top-level">
  → OpenTUI 增量解析重用穩定區段，只有最後 2 個 block 重建
  → streaming=true 使 textBuffer 同步更新，無 two-phase 閃爍
  → streaming flag 翻轉時元素不摧毀（OpenTUI setter 就地 re-parse）
```

---

*本文件記錄 2026-07-26 的完整 trace 過程與修復方案。若後續發現新的閃爍模式，請在第 8 節新增排查記錄。*
