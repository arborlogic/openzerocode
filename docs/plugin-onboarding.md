# Plugin Onboarding Guide

> 這份文件說明如何為 openzerocode 開發一個新的 plugin。
> 適用對象：你自己（或任何想擴充 openzerocode 的開發者）。

---

## 一句話總結

建立 `src/plugins/<plugin-name>/index.ts`，export 一個符合 `Plugin` 型別的物件，然後在 `src/plugin/loader.ts` 註冊它。

---

## 完整步驟

### Step 1：建立目錄

```bash
mkdir -p src/plugins/<plugin-name>
```

### Step 2：建立 Plugin 檔案

```ts
// src/plugins/my-plugin/index.ts
import type { Plugin } from "../../plugin/types"

export const myPlugin: Plugin = {
  id: "my-plugin",          // 唯一識別碼，不能跟其他 plugin 衝突
  name: "My Plugin",        // 顯示名稱
  version: "0.1.0",
  
  // 可選：註冊 slash 指令
  commands: [
    {
      name: "hello",
      description: "Say hello",
      args: "<name>",
      async execute(args, ctx) {
        ctx.notices(`Hello, ${args || "world"}!`, "system")
      },
    },
  ],

  // 可選：注入 system prompt 片段
  systemPrompt: () => {
    return "You have access to a hello plugin. Users can say /hello."
  },

  // 可選：在 LLM 請求前插入 context
  beforeRequest: async (input, history) => {
    return { input, extraMessages: [] }
  },

  // 可選：在 LLM 回應後執行（例如儲存記憶）
  afterResponse: async (input, response, history) => {
    // do something
  },
}
```

### Step 3：在 Loader 註冊

打開 `src/plugin/loader.ts`，加入你的 plugin：

```ts
// src/plugin/loader.ts

// ... 既有 imports ...
import { myPlugin } from "../plugins/my-plugin/index"

const PLUGINS = [
  echoPlugin,
  myPlugin,       // ← 加在這裡
  // 以後的 plugin 都加在這裡
]

export function loadBuiltinPlugins() {
  for (const plugin of PLUGINS) {
    pluginRegistry.register(plugin)
  }
}
```

### Step 4：驗證

啟動 TUI：

```bash
npm run start
```

輸入 `/hello`，應該會看到 "Hello, world!" 的通知。

---

## Plugin 合約

一個 plugin 必須滿足以下條件：

### 必要

| 欄位 | 說明 |
|------|------|
| `id` | 唯一識別碼，建議用 kebab-case。不可與其他 plugin 重複。 |
| `name` | 可讀的名稱 |

### 選用

| 欄位 | 說明 |
|------|------|
| `version` | semver 字串 |
| `commands` | Slash 指令陣列。每個指令有 `name`, `description`, `args?`, `execute()` |
| `systemPrompt` | 回傳字串的 function，內容會附加到 system prompt 尾部 |
| `beforeRequest` | 每次 LLM 請求前呼叫。可修改 input 或插入 extra messages |
| `afterResponse` | 每次 LLM 回應後呼叫。可用來儲存記憶、記錄修正 |

### 指令的 execute()

```ts
async execute(args: string, ctx: PluginCommandContext): Promise<string | void>
```

- `args` — 指令後的參數字串（例如 `/memory search hello` 的 args 是 `"search hello"`）
- `ctx.notices(text, kind?)` — 顯示通知給使用者
- 回傳值—如果有回傳字串，會自動以 system notice 顯示

### beforeRequest()

```ts
async beforeRequest(
  input: string,
  history: Message[],
): Promise<{ input?: string; extraMessages?: Message[] }>
```

- `input` — 使用者輸入
- `history` — 目前的對話歷史
- 回傳 `input`（可取代使用者輸入）和 `extraMessages`（可插入額外訊息）
- 什麼都不做就回傳 `{ input, extraMessages: [] }`

### afterResponse()

```ts
async afterResponse(
  input: string,
  response: Message,
  history: Message[],
): Promise<void>
```

- `input` — 原始使用者輸入
- `response` — LLM 的回應 Message
- `history` — 包含新回應的完整對話歷史

---

## 與外部服務串接

Plugin 可以直接 `fetch` 外部 API。zero-api client 程式碼保留在 `src/plugin/zero-api.ts`
供參考，但目前未 active 使用。

---

## 目錄結構慣例

```
src/plugins/<plugin-name>/
├── index.ts          # Plugin 定義 + export
├── types.ts          # (可選) 專屬型別
├── store.ts          # (可選) 儲存層
└── commands.ts       # (可選) 指令邏輯拆分
```

如果 plugin 很小，全部寫在 `index.ts` 即可。

---

## 常見問題

### Q: 可以 disable 某個 plugin 嗎？

現階段不行，Plugin 在啟動時全部載入。預計之後支援 config 檔控制啟用狀態。

### Q: Plugin 之間可以互相依賴嗎？

不建議。Plugin 應該是獨立的。如果兩個 plugin 需要共享邏輯，提取到 `src/plugin/` 共用模組。

### Q: 可以在 plugin 裡使用 npm 套件嗎？

可以。Plugin 是 openzerocode 的一部分，直接 `import` 即可（前提是該套件已在 `package.json` 中）。
