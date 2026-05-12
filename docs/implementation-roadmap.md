# OpenZeroCode — 實作建議參考文件

根據對 [opencode](../submodules/opencode) 原始碼的深度分析整理。
聚焦在「現在 openzerocode 缺什麼、怎麼做最值得」。

---

## 1. 訊息格式統一（最優先）

### 現狀問題
`Message` 目前只有 `role / content / tool_calls / reasoning_content`，結構扁平。
當一次回應同時包含文字 + 多個工具呼叫 + reasoning 時，重建 UI 狀態很脆弱。

### opencode 怎麼做
```typescript
// 每一條 Message 的 content 是 Part 陣列
type Part =
  | { type: "text";         text: string }
  | { type: "reasoning";    text: string }
  | { type: "tool-call";    id: string; tool: string; input: unknown }
  | { type: "tool-result";  id: string; output: string; error?: boolean }
  | { type: "media";        url: string; mediaType: string }

interface Message {
  id: string
  role: "user" | "assistant" | "tool"
  parts: Part[]
  createdAt: number
}
```

### 建議實作
1. 在 `src/provider/types.ts` 新增 `Part` union type
2. 把 `reasoning_content` 和 `tool_calls` 改成 parts，provider adapter 負責轉換
3. 好處：UI 渲染只需要 iterate parts，不用特判欄位

---

## 2. 工具系統強化

### 現狀問題
工具用 Effect Schema 定義但沒有以下功能：
- 執行前的權限詢問（approve/deny 記憶）
- 執行逾時與強制中止
- 輸出截斷（大型輸出會讓 context 爆掉）

### opencode 的 Tool Context
```typescript
interface ToolContext {
  abort: AbortSignal
  sessionId: string
  cwd: string
  root: string
  // 核心：執行前可暫停等待使用者決定
  ask(permission: string, metadata: unknown): Effect.Effect<boolean>
  // 記錄 side effect（用於 undo / audit）
  metadata(key: string, value: unknown): Effect.Effect<void>
}
```

### 建議實作（分三步）

**Step 1 — 輸出截斷（一天內可做完）**
```typescript
// src/tool/tool.ts
const MAX_OUTPUT = 20_000 // chars

function truncateOutput(text: string): string {
  if (text.length <= MAX_OUTPUT) return text
  const half = MAX_OUTPUT / 2
  return text.slice(0, half) + `\n\n[... ${text.length - MAX_OUTPUT} chars truncated ...]\n\n` + text.slice(-half)
}
```

**Step 2 — 逾時控制**
```typescript
// 在 execute 外層 wrap
const withTimeout = <A>(effect: Effect.Effect<A>, ms = 120_000) =>
  Effect.timeout(effect, ms).pipe(
    Effect.catchTag("TimeoutException", () =>
      Effect.succeed(new Result({ title: "Timeout", output: `Tool exceeded ${ms}ms` }))
    )
  )
```

**Step 3 — 權限記憶（allow always）**
```typescript
// src/permission/index.ts
type Rule = { pattern: string; action: "allow" | "deny" | "ask" }

class PermissionService {
  private rules: Rule[] = []

  evaluate(toolName: string): "allow" | "deny" | "ask" {
    // 後面的規則覆蓋前面（last-match wins）
    let result: "allow" | "deny" | "ask" = "ask"
    for (const rule of this.rules) {
      if (minimatch(toolName, rule.pattern)) result = rule.action
    }
    return result
  }

  addRule(rule: Rule) { this.rules.push(rule) }
}
```

---

## 3. 對話持久化升級

### 現狀問題
`~/.openzerocode/sessions/last.json` 只存最後一個 session，沒有 ID、搜尋、列表功能。

### opencode 怎麼做
- SQLite + Drizzle ORM
- 每條 message 獨立存一列，有 `sessionId` 外鍵
- 可按 `createdAt` 排序、全文搜尋、列出所有 session

### 建議實作（可用 better-sqlite3，不需 ORM）

```typescript
// src/session/db.ts
import Database from "better-sqlite3"
import { homedir } from "os"
import { join } from "path"

const DB_PATH = join(homedir(), ".openzerocode", "sessions.db")

export function openDb() {
  const db = new Database(DB_PATH)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES sessions(id),
      role TEXT,
      content TEXT,  -- JSON
      created_at INTEGER
    );
  `)
  return db
}
```

新增 CLI 指令：
- `/sessions` — 列出最近 10 個 session
- `/session <id>` — 切換到指定 session
- `/new` — 開一個新 session

---

## 4. Provider 抽象層重構

### 現狀問題
`bigPickleLayer` 綁死了一個 provider，`model` 也是環境變數傳入的字串，沒有型別保護。

### opencode 的做法
每個 provider 是獨立模組，匯出統一介面：
```typescript
interface ProviderDefinition {
  id: string
  name: string
  models: ModelDefinition[]
  create(config: ProviderConfig): Provider
}
```

### 建議實作
```typescript
// src/provider/registry.ts
const providers = new Map<string, ProviderDefinition>()

export function registerProvider(def: ProviderDefinition) {
  providers.set(def.id, def)
}

export function getProvider(id: string): ProviderDefinition {
  const p = providers.get(id)
  if (!p) throw new Error(`Unknown provider: ${id}`)
  return p
}
```

短期：至少支援切換 OpenAI-compatible base URL，讓 `/model` 指令可以帶 `provider:model` 格式：
```
/model openai:gpt-4o
/model anthropic:claude-opus-4
/model local:llama3
```

---

## 5. 串流輸出即時顯示

### 現狀問題
目前是等整個 response 收完再 render，使用者沒有打字中的視覺回饋。

### opencode 的做法
每個 `text-delta` 事件都立即更新 UI，游標在最後一個 token 後面閃爍。

### 建議實作

```typescript
// 在 runSession 的 reader.read() 迴圈裡
while (true) {
  const { done, value } = await reader.read()
  if (done) break

  if (value.delta.content) {
    collectedContent += value.delta.content
    // ★ 新增：即時更新 screen
    screen.setStreamingContent(collectedContent)
  }
}
// 串流結束後，改成正式的 addAssistant
screen.clearStreamingContent()
screen.addAssistant(renderMarkdown(collectedContent))
```

在 `Screen` 裡新增：
```typescript
private streamingContent = ""

setStreamingContent(text: string) {
  this.streamingContent = text
  this.render()
}

// render() 裡：如果有 streamingContent，在最後一列顯示 "▌" cursor
```

---

## 6. Edit Tool — 精準字串替換

### 現狀問題
目前 `write` 工具是整個檔案覆蓋，沒有精準編輯能力，容易破壞原有格式。

### opencode 的 edit tool 核心邏輯
```
oldString → newString 替換
↓
1. 精準字串比對（要求唯一）
2. 找不到時 → Levenshtein 模糊比對（容忍空白差異）
3. 寫入前顯示 diff 讓使用者確認
4. 儲存 FileDiff 快照（可 undo）
5. 執行 formatter（如 prettier）
```

### 建議實作

```typescript
// src/tool/edit.ts
export const editTool = Tool.make({
  id: "edit",
  description: "Replace a specific string in a file. oldString must be unique.",
  parameters: Schema.Struct({
    path:      Schema.String,
    oldString: Schema.String,
    newString: Schema.String,
  }),
  execute({ path, oldString, newString }, ctx) {
    return Effect.gen(function* () {
      const content = yield* Effect.promise(() => fs.readFile(path, "utf-8"))
      const count = content.split(oldString).length - 1
      if (count === 0) return new Result({ title: "Not found", output: `oldString not found in ${path}` })
      if (count > 1)  return new Result({ title: "Ambiguous", output: `oldString matches ${count} locations — be more specific` })

      const updated = content.replace(oldString, newString)
      yield* Effect.promise(() => fs.writeFile(path, updated, "utf-8"))
      return new Result({ title: "Edited", output: `Replaced in ${path}` })
    })
  }
})
```

---

## 7. Agent 模式（多步驟自動執行）

### 現狀問題
目前每個工具呼叫都要手動確認，沒有 "let it run" 模式。

### opencode 的 Agent 概念
```typescript
interface AgentConfig {
  name:        string
  model:       string
  system?:     string        // 覆蓋 system prompt
  maxSteps?:   number        // 防止無限迴圈
  permissions: Rule[]        // 這個 agent 可以自動執行什麼
  tools?:      string[]      // 白名單工具
}
```

### 建議實作（最小可行版）

新增 `OPENZEROCODE_AGENT_MODE=full` 環境變數或 `/agent` 指令，讓使用者一鍵進入「所有工具自動核准 + 最多 30 步」模式：

```typescript
// cli.ts
case "/agent":
  agentMode = true
  maxSteps = 30
  screen.addTool("agent mode: on (all tools auto-approved, max 30 steps)")
  continue
```

---

## 8. Undo / Snapshot

### 現狀問題
工具寫入檔案後無法復原，一個 hallucination 就可能破壞程式碼。

### opencode 的做法
每次 write/edit 之前，記錄 `FileDiff`：
```typescript
interface FileDiff {
  path:      string
  before:    string   // 原始內容
  after:     string   // 寫入內容
  timestamp: number
  sessionId: string
}
```

### 建議實作

```typescript
// src/session/snapshot.ts
class SnapshotService {
  private diffs: FileDiff[] = []

  async before(path: string): Promise<string> {
    const content = await fs.readFile(path, "utf-8").catch(() => "")
    return content
  }

  record(diff: FileDiff) { this.diffs.push(diff) }

  async undo() {
    const last = this.diffs.pop()
    if (!last) return
    await fs.writeFile(last.path, last.before, "utf-8")
  }
}
```

新增 `/undo` 指令，呼叫 `SnapshotService.undo()`。

---

## 9. MCP (Model Context Protocol) 支援

### 什麼是 MCP
標準化的工具擴充協議，讓外部工具 server（瀏覽器、資料庫、Figma 等）可以用統一介面接入 AI 助理。

### opencode 的實作
```
config.json → mcp servers 清單
→ 啟動時 spawn child process
→ 透過 stdio 或 SSE 連線
→ 呼叫 tools/list, resources/list
→ 動態注入 Tool Registry
```

### 建議實作時間點
短期：先不做，確保核心工具穩定。
中期：加入 `~/.openzerocode/config.json` 支援 MCP server 設定：
```json
{
  "mcp": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    "github":     { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }
  }
}
```

---

## 優先順序建議

| 優先 | 項目 | 難度 | 效益 |
|------|------|------|------|
| P0 | 工具輸出截斷 | 低 | 防止 context 爆掉 |
| P0 | 串流即時顯示 | 中 | 大幅改善體驗 |
| P1 | Edit tool（字串替換）| 中 | 核心能力缺口 |
| P1 | 多 session 持久化 | 中 | 實用性大幅提升 |
| P1 | 權限記憶（allow always）| 低 | 減少確認疲勞 |
| P2 | Part-based message format | 中 | 架構整潔度 |
| P2 | Undo / snapshot | 中 | 安全性 |
| P2 | Agent mode | 低 | 進階使用者 |
| P3 | Provider registry | 高 | 彈性 |
| P3 | MCP 支援 | 高 | 生態系整合 |

---

*參考來源：`/submodules/opencode` — packages/llm, packages/opencode, packages/app*
