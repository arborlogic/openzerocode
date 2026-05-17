# Plugin System

## 檔案結構

```
src/plugin/
├── types.ts      — Plugin, PluginCommand, PluginCommandContext 型別
├── registry.ts   — PluginRegistry class（註冊 + 查詢）
├── loader.ts     — Plugin 載入器（內建 + 外部掃描）
├── zero-api.ts   — zero-api HTTP client
└── index.ts      — barrel export

src/plugins/
└── echo/         — 內建測試用 plugin
    └── index.ts
```

## 運作方式

### 啟動時

1. `loadBuiltinPlugins()` — 同步載入 compile-time 綁定的 plugin（echo 等）
2. `loadExternalPlugins()` — 非同步掃描 `~/.openzerocode/plugins/` 載入外部 plugin

### 外部 Plugin 安裝

把一個 .ts 檔放到 `~/.openzerocode/plugins/` 即可：

```ts
// ~/.openzerocode/plugins/my-plugin.ts
import type { Plugin } from "openzerocode/plugin"

const plugin: Plugin = {
  id: "my-plugin",
  name: "My Plugin",
  commands: [{
    name: "hello",
    description: "Say hello",
    execute: async (args, ctx) => {
      ctx.notices(`Hello ${args}!`, "system")
    }
  }]
}

export { plugin }
```

不需要重新 build、不需要改 source code。
