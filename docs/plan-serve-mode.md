# Plan: Serve Mode — Streaming Session API

## 目標

讓 openzerocode 可以以 HTTP server 模式啟動，對外暴露一個乾淨的 API：

```
POST /session               → 建立 session（指定 workdir）
POST /session/:id/prompt    → 送 prompt，直接拿到 streaming response
GET  /session/:id           → 取得 session info
DELETE /session/:id         → 刪除 session
```

整個流程一個 HTTP request 就能完成 prompt + 接收 streaming，不需要另外建立 SSE 連線。

---

## 現況分析

### 已有的基礎

| 項目 | 位置 | 狀態 |
|------|------|------|
| Session 持久化 | `src/client/sessions.ts` | ✅ 完整，`SessionMeta` 已有 `directory` 欄位 |
| Streaming agent loop | `src/client/session-runner.ts` | ✅ 完整，但跟 TUI callbacks 緊耦合 |
| Provider 抽象層 | `src/provider/` | ✅ 完整，可獨立使用 |
| Tool system | `src/tool/registry.ts` | ✅ 完整，可獨立使用 |

### 需要解決的問題

1. **`session-runner.ts` 的 `cwd` 寫死為 `process.cwd()`**（第 255-256 行）  
   tool 執行時要改用 session 的 workdir

2. **`runSession()` 的 `SessionUi` 介面跟 TUI 緊耦合**  
   有 `streamAssistantChunk`、`scrollBottom`、`notify` 等 TUI 專用 callback  
   HTTP server 用不到這些，需要拆層

3. **沒有 HTTP server 入口**  
   目前只有 TUI 模式，需要新增 serve subcommand

4. **`createSession()` 的 workdir 固定取 `process.cwd()`**（第 129 行）  
   需要改成可以傳入指定路徑

---

## 改動計畫

### Phase 1：解耦 session-runner（核心改動）

**目標**：讓 streaming 邏輯可以在沒有 TUI 的情況下使用。

**做法**：在 `session-runner.ts` 提取出一個 `streamSession()` generator，
`runSession()` 改成消費這個 generator（維持向後相容，TUI 不需要改）。

```
Before:
  runSession(input, history, ui: SessionUi, runtime) → Promise<Message[]>
  └─ 直接 call ui.streamAssistantChunk() 等 TUI callback

After:
  streamSession(input, history, options, runtime) → AsyncGenerator<StreamChunk>
  runSession(input, history, ui, runtime) → Promise<Message[]>
  └─ for await chunk of streamSession() → 轉換成 TUI callback（不改現有行為）
```

**`StreamChunk` 型別定義**（新建 `src/server/types.ts`）：

```typescript
export type StreamChunk =
  | { type: "text";         content: string }
  | { type: "reasoning";    content: string }
  | { type: "tool_start";   id: string; name: string; input: string }
  | { type: "tool_result";  id: string; name: string; output: string; error: boolean }
  | { type: "status";       text: string }
  | { type: "usage";        inputTokens: number; outputTokens: number; cachedTokens: number }
  | { type: "error";        message: string }
  | { type: "done" }
```

**`streamSession()` 需要的 options**（取代 `SessionUi` 的 TUI 部分）：

```typescript
type StreamOptions = {
  abort: AbortSignal
  model: string
  mode: RunMode
  provider: string
  keyName: string
  workdir: string        // ← 新增，取代 process.cwd()
}
```

**變更檔案**：`src/client/session-runner.ts`
- 提取 `streamSession()` generator
- `runSession()` 改為消費 generator，行為不變
- tool 執行的 `cwd` / `root` 改用 `options.workdir`（原本第 255 行的 `process.cwd()`）

---

### Phase 2：sessions.ts 加上顯式 workdir 參數

**變更檔案**：`src/client/sessions.ts`

`createSession()` 目前：
```typescript
export function createSession(model: string, provider: string, messages?: Message[]): SessionMeta
// 內部 directory: process.cwd()  ← 第 129 行
```

改為：
```typescript
export function createSession(
  model: string,
  provider: string,
  messages?: Message[],
  workdir?: string,   // ← 新增，不傳就 fallback 到 process.cwd()
): SessionMeta
```

---

### Phase 3：HTTP Server

**新建 `src/server/index.ts`**

使用 `Bun.serve()`，不需要額外依賴。

#### Endpoints

**`POST /session`**
```
Body:  { workdir: string, model?: string, provider?: string, mode?: "build" | "plan" }
Resp:  { id: string, workdir: string, model: string, provider: string, createdAt: number }
```

**`POST /session/:id/prompt`**
```
Body:  { text: string, mode?: "build" | "plan" }
Resp:  Content-Type: application/x-ndjson  (streaming)

每行一個 JSON chunk:
{"type":"text","content":"好的，我來看一下"}
{"type":"tool_start","id":"call_0","name":"read","input":"{\"path\":\"src/foo.ts\"}"}
{"type":"tool_result","id":"call_0","name":"read","output":"...","error":false}
{"type":"usage","inputTokens":1234,"outputTokens":56,"cachedTokens":0}
{"type":"done"}
```

選用 NDJSON（而非 SSE）的原因：
- 一個 POST request 直接拿到 streaming body，呼叫端不需要另開連線
- 任何 HTTP client 都能直接消費（`curl`, `fetch`）
- 比 SSE 格式更簡單，工具相容性更好

**`GET /session/:id`**
```
Resp:  { id, title, workdir, model, provider, messageCount, createdAt, updatedAt }
```

**`DELETE /session/:id`**
```
Resp:  { ok: true }
```

#### 錯誤處理

所有錯誤回傳：
```json
{ "error": "message", "code": "NOT_FOUND" | "BAD_REQUEST" | "INTERNAL" }
```

prompt streaming 中若發生錯誤，flush 一個 `{ "type": "error", "message": "..." }` 後關閉 stream。

---

### Phase 4：CLI subcommand

**變更檔案**：`bin/openzerocode`（或現有 CLI 入口）

新增：
```bash
openzerocode serve [--port 4096] [--host 127.0.0.1]
```

- 預設 port：`4096`
- 預設 host：`127.0.0.1`（只監聽 localhost，避免意外對外暴露）
- 啟動後 stdout 印出：`openzerocode server listening on http://127.0.0.1:4096`

---

## 檔案變更總覽

```
src/
├── client/
│   ├── sessions.ts          ← createSession() 加 workdir 參數
│   └── session-runner.ts    ← 提取 streamSession() generator，cwd 改用 workdir
├── server/                  ← 全新目錄
│   ├── index.ts             ← Bun.serve() + route dispatch
│   └── types.ts             ← StreamChunk 型別定義
bin/
└── openzerocode             ← 加 serve subcommand
```

**TUI 完全不受影響**（`runSession()` 介面不變，內部改成消費 generator）

---

## 實作順序

```
1. src/server/types.ts          新增 StreamChunk 型別（無依賴，先做）
2. src/client/sessions.ts       createSession() 加 workdir 參數（小改）
3. src/client/session-runner.ts 提取 streamSession() generator（核心）
4. src/server/index.ts          HTTP server（消費 generator）
5. bin/openzerocode             加 serve subcommand（收尾）
```

---

## 使用範例

```bash
# 啟動 server
openzerocode serve --port 4096

# 建立 session
curl -X POST http://127.0.0.1:4096/session \
  -H "Content-Type: application/json" \
  -d '{"workdir": "/path/to/project", "model": "claude-sonnet-4-6"}'
# → {"id":"ses_abc123","workdir":"/path/to/project",...}

# 送 prompt，接收 streaming
curl -X POST http://127.0.0.1:4096/session/ses_abc123/prompt \
  -H "Content-Type: application/json" \
  -d '{"text": "這個 bug 在哪裡？"}' \
  --no-buffer
# → {"type":"text","content":"我來看一下"}
# → {"type":"tool_start","id":"call_0","name":"read","input":"..."}
# → {"type":"tool_result","id":"call_0","name":"read","output":"...","error":false}
# → {"type":"text","content":"問題在第 42 行..."}
# → {"type":"done"}
```

---

## 範圍外（不在本次計畫）

- Auth / API key 保護（之後視需求加）
- 多 client 同時連線同一 session 的 broadcast
- WebSocket 支援
- `/session/:id/messages` 取得歷史訊息 endpoint
