# OpenZeroCode

語言：[English](./README.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md)

> **以終端機為優先的 AI 程式開發代理，靈感來自 [OpenCode](https://github.com/sst/opencode)。**

OpenZeroCode 是一個本機優先、由 TUI 驅動的 AI 程式開發助手，沿著 OpenCode 的方向改造而來。它移除了對 `zero` 雲端服務的依賴，專注於自包含的終端機體驗，內建工具、多 Provider 支援，以及工作區記憶。

![OpenZeroCode 預覽](./preview01.png)

---

## 靈感來源

本專案**深受 OpenCode 啟發**。OpenCode 是終端機原生 AI 程式開發代理。OpenZeroCode 最初延續了 OpenCode 的架構方向，之後逐步發展出自己的定位：

- **相同基礎**：SolidJS 終端機 UI（`@opentui`）、Provider 抽象、工具系統、會話持久化
- **不同重點**：本機優先、獨立於 `zero` 生態、便於擴充自訂工作流程
- **共同脈絡**：Provider 註冊、工具註冊和建置流程模式都承襲自 OpenCode 的設計思路

感謝 OpenCode 專案的設計，本專案正是站在它的基礎上誕生的。

---

## 目前狀態

這個 repo 仍在積極實作中。目前已具備：

- **基於 Solid 的終端機 UI**：入口位於 `src/client/tui.tsx`，支援串流回應、推理展示和命令面板
- **Build / Plan 模式切換**：在結構化執行和自由探索之間切換
- **Provider 切換**：OpenCode Zen、OpenAI、OpenAI Codex、OpenRouter、Zero-API、DeepSeek，以及可設定的 OpenAI-compatible 端點
- **模型切換**：執行中切換模型
- **多會話持久化**：會話儲存於 `~/.openzerocode/sessions`
- **會話管理**：重新命名、刪除、壓縮會話，以及 timeline 操作（revert/copy/fork）
- **Headless 與 server 模式**：用 `--run` 做一次性 CLI 執行，用 `serve` 啟動 streaming HTTP API
- **側邊欄上下文**：Token 用量、費用追蹤、Git diff 摘要
- **工作區提示記憶**：將 `AGENTS.md` 指令和 `CONTEXT.md` 專案上下文注入系統提示詞
- **會話交接**：使用 `SESSION_SUMMARY.md` 保存精簡的本機續接筆記
- **GEASS browser 工具**：可選的瀏覽器導覽、讀取、互動、截圖與視覺觀察
- **16 個內建工具**：

| 工具 | 說明 |
|------|------|
| `read` | 讀取檔案內容 |
| `write` | 寫入或覆寫檔案 |
| `grep` | 依模式搜尋檔案內容 |
| `glob` | 依 glob 模式尋找檔案 |
| `bash` | 執行 shell 命令 |
| `edit` | 定向字串替換編輯 |
| `web-fetch` | 從 URL 取得內容 |
| `todo-write` | 在多步驟工作中維護結構化任務清單 |
| `browser-navigate` | 將連線中的 GEASS browser 導覽到 URL |
| `browser-read` | 讀取目前 GEASS browser 頁面的結構化內容 |
| `browser-click` | 點擊 GEASS browser 頁面元素 |
| `browser-type` | 在 GEASS browser 輸入欄位中輸入文字 |
| `browser-select` | 選取 GEASS browser 下拉選單選項 |
| `browser-scroll` | 捲動目前 GEASS browser 頁面 |
| `browser-screenshot` | 擷取瀏覽器截圖 |
| `browser-observe-visual` | 以視覺方式檢查目前瀏覽器畫面 |

![OpenZeroCode TUI 會話](./docs/assets/openzerocode-demo.gif)

---

## 快速開始

### 前置條件

原始碼開發需要 **bun** >= 1.2，以及 `PATH` 中可用的 **npm**。

### 安裝腳本

Release installer 參考 opencode 的使用者層級安裝方式：預設把二進位檔安裝到 `~/.openzerocode/bin`，並在需要時更新你的 shell 設定，把該目錄加入 `PATH`。

```bash
curl -fsSL https://github.com/arborlogic/openzerocode/releases/latest/download/install | bash
```

如果想手動更新 `PATH`，可使用 `--no-modify-path`；也可以設定 `OPENZEROCODE_INSTALL_DIR` 指定其他可寫入的安裝目錄。

### 從 npm 安裝

目前支援的預先建置 npm 目標：

- `darwin-arm64`
- `linux-x64`
- `linux-arm64`
- `win32-x64`

安裝：

```bash
npm install -g openzerocode
```

根套件會安裝一個很小的 Node 啟動器，並在執行時解析符合平台的可選套件。

### 從原始碼安裝

```bash
git clone https://github.com/arborlogic/openzerocode.git
cd openzerocode
python3 scripts/dev-install.py
```

這是目前支援的本機開發安裝路徑。它會安裝依賴，使用帶時間戳的 `-dev.YYYYMMDDHHMMSS` 版本後綴重新建置 `dist/openzerocode`，並執行 `npm install -g .`，讓全域 `openzerocode` 命令指向本機建置的二進位檔。

### 執行

```bash
openzerocode
```

### 開發模式

```bash
npm run dev
```

### 更新

```bash
git pull
python3 scripts/dev-install.py
```

這會更新依賴、重新建置二進位檔，並從你的本機 checkout 重新安裝全域 `openzerocode` 命令。

### npm 打包流程

發布到 npm 的產物採用「根啟動器 + 平台套件」的結構：

- 根套件 `openzerocode` 只包含 Node 啟動器 `bin/openzerocode.js`
- 平台二進位檔位於 `@openzerocode/<target>` 可選依賴中
- 目前支援目標：`darwin-arm64`、`linux-x64`、`linux-arm64`、`win32-x64`

典型流程：

1. **建置本機二進位檔**

   ```bash
   npm run build
   ```

   這會執行 `scripts/build.sh`，預設輸出 `dist/openzerocode`。

2. **產生 `npm/` 發布暫存結構**

   ```bash
   node scripts/create-platform-packages.mjs
   ```

   這會建立：

   - `npm/package.json`：根 npm 套件 manifest
   - `npm/bin/openzerocode.js`：依平台分派到對應二進位檔的啟動器
   - `npm/packages/<target>/package.json`：各平台套件 manifest
   - `npm/README.md`、`npm/LICENSE`、`npm/bin/package.json`：發布輔助檔案

3. **在對應原生平台建置各平台二進位檔**

   ```bash
   scripts/build-platform-package.sh darwin-arm64
   scripts/build-platform-package.sh linux-x64
   scripts/build-platform-package.sh linux-arm64
   scripts/build-platform-package.sh win32-x64
   ```

   `scripts/build-platform-package.sh` 必須在符合的宿主平台執行。例如，`linux-arm64` 必須在 `linux-arm64` 機器上建置。建置成功後會輸出到：

   - `npm/packages/<target>/bin/openzerocode`
   - Windows 目標：`npm/packages/win32-x64/bin/openzerocode.exe`

4. **打包或發布 npm 套件**

   完成暫存結構和平台二進位建置後，在 `npm/` 和各 `npm/packages/<target>/` 目錄中執行 `npm pack` 或 `npm publish`。

   建議順序：

   - 先發布平台套件 `@openzerocode/<target>`
   - 再發布根套件 `openzerocode`

5. **發布檢查清單**

   先在 `CHANGELOG.md` 加好目標版本的真實 entry。接著使用 release script 準備版本更新、release commit，以及符合的 git tag：

   ```bash
   npm run release -- patch       # 或：minor、major、明確版本例如 0.4.3
   npm run release -- patch --dry-run
   npm run release -- patch --push
   ```

   Script 不允許無關的 working-tree changes，會驗證 `CHANGELOG.md` 已包含目標版本 entry，更新 `package.json` 與存在時更新 `package-lock.json`，一併 stage changelog entry，預設執行 `npm run typecheck`，提交 `chore: release v<version>`，並建立 `v<version>` tag。只有在明確想略過 typecheck 時才使用 `--no-verify`。

   發布前後請確認：

   - 執行 release script 前，確認目標版本 changelog entry 已完整
   - 如果沒有傳入 `--push`，請同時推送 release commit 和 tag：`git push origin HEAD && git push origin v<version>`
   - `.github/workflows/build.yml` 一律建置並上傳 root/platform npm tarball，以及直接二進位 release archive（Linux/macOS 為 `.tar.gz`，Windows 為 `.zip`）
   - Tag push 會用這些 artifacts 建立符合的 GitHub Release，並自動發布 npm 套件
   - npm 發布會先發布平台套件，再發布根套件 `openzerocode`，已存在的版本會略過
   - 如果 workflow 失敗且只需要重新執行，請從 Actions 頁面使用 `workflow_dispatch`；這種情況不需要再次 bump 版本或重新執行 release script。啟用 `publish_to_npm` 可重新執行 npm 發布，或提供既有 tag 並啟用 release option 來重新建立/更新 GitHub Release
   - 發布後，請從 GitHub Release artifacts 驗證 `openzerocode --version`，並驗證 `npm install -g openzerocode`

這種結構讓 `npm install -g openzerocode` 保持輕量，同時由 npm 解析平台專屬可選套件中的真實可執行檔。

### 命令列用法

```bash
openzerocode                         # 啟動 TUI
openzerocode --version               # 顯示版本
openzerocode --help                  # 顯示 CLI help
openzerocode --run "fix the tests"    # Headless 執行一次 prompt，工具自動核准
openzerocode serve --port 4096       # 啟動 streaming HTTP API server
```

環境變數覆寫：

| 變數 | 作用 |
|------|------|
| `OPENZERO_MODEL` | 覆寫 headless `--run` 模式使用的預設模型 |
| `OPENZEROCODE_PROVIDER_CONFIG` | 覆寫 provider 設定檔路徑（預設 `~/.openzerocode/providers.json`） |

### 備用入口

```bash
npm run start:tui
```

---

## Provider 設定

Provider 憑證可以透過環境變數或本機設定檔提供：

```text
~/.openzerocode/providers.json
```

格式：

```json
{
  "providers": {
    "openrouter": {
      "activeKey": "default",
      "keys": {
        "default": "sk-or-...",
        "backup": "sk-or-..."
      },
      "baseURL": "https://openrouter.ai/api/v1"
    }
  }
}
```

**支援的 Provider：**

| Provider id | 名稱 | 環境變數 |
|-------------|------|----------|
| `opencode-zen` | OpenCode Zen | `OPENCODE_API`、`OPENCODE_API_KEY`（可選；可匿名使用免費模型） |
| `openai` | OpenAI | `OPENAI_API_KEY` |
| `openai-codex` | OpenAI Codex | 透過 `/codex-login` 使用 ChatGPT OAuth |
| `openrouter` | OpenRouter | `OPENROUTER_API_KEY` |
| `zero-api` | Zero-API-compatible local endpoint | `ZERO_API_KEY` |
| `deepseek` | DeepSeek | `DEEPSEEK_API_KEY` |

**說明：**

- 每個 Provider 可以有多個命名 key。
- `activeKey` 決定執行時使用該 Provider 的哪個 key。
- `baseURL` 可以覆寫 Provider 的預設端點，供 compatible API 使用。
- 設定檔中的值優先順序高於環境變數。
- 可以在 TUI 中透過斜線命令和 command palette 查看或切換 Provider、模型和 key。

---

## 開發

```bash
# 型別檢查
npm run typecheck

# 執行所有單元測試（排除 Provider 整合測試）
npm run test:unit

# 執行單一測試檔
npx tsx --test src/client/workspace-memory.test.ts
```

更多說明見 [DEVELOPMENT.md](./DEVELOPMENT.md)，包括：

- 建置獨立二進位檔
- 跨平台發布
- 建置系統與 `Bun.build()` 編譯

---

## 架構

```text
┌─ TUI client ──────────────────────────────────┐
│  src/client/tui.tsx                            │
│  - transcript / response rendering             │
│  - command palette & autocomplete              │
│  - session management (create, rename, delete) │
│  - build / plan mode toggle                    │
│  - sidebar: token usage, cost, git summary     │
│  - workspace memory + skill injection          │
└────────┬───────────────────────────────────────┘
         │
         ├── provider layer ─────────────────────┐
         │  src/provider/registry.ts             │
         │  - OpenCode Zen (opencode-zen)         │
         │  - OpenAI / OpenAI Codex              │
         │  - OpenRouter / Zero-API / DeepSeek   │
         │  - Extensible via registry            │
         └───────────────────────────────────────┘
         │
         └── tool layer ─────────────────────────┐
            src/tool/registry.ts                 │
            - file/search/shell/edit/web tools    │
            - todo + GEASS browser tools         │
            - Permission / auto-approve system   │
            └────────────────────────────────────┘
```

## 工作區記憶模型

OpenZeroCode 將 repo 記憶拆分為三個輕量檔案：

- `AGENTS.md`：穩定的 repo 專屬指令、工作流程和約束。
- `CONTEXT.md`：背景上下文、共享詞彙，以及值得在提示詞中揭露的已知不一致。
- `SESSION_SUMMARY.md`：給人類或後續續接用的簡短交接筆記；不會自動注入系統提示詞。

目前自動提示詞組裝路徑會透過 `src/client/workspace-memory.ts` 從最近的工作區載入 `AGENTS.md` 和 `CONTEXT.md`。

### 關鍵原始碼檔案

| 檔案 | 用途 |
|------|------|
| `src/client/tui.tsx` | 主 TUI 入口和 UI 編排 |
| `src/client/sessions.ts` | 會話持久化輔助邏輯 |
| `src/client/workspace-memory.ts` | 將 `AGENTS.md` 和 `CONTEXT.md` 載入系統提示詞 |
| `SESSION_SUMMARY.md` | 手動會話交接和續接筆記 |
| `src/provider/registry.ts` | Provider 註冊和解析 |
| `src/tool/registry.ts` | 內建工具註冊 |
| `src/server/index.ts` | `openzerocode serve` 使用的 streaming HTTP API server |

---

## 與 OpenCode 的關係

| 方面 | OpenCode | OpenZeroCode |
|------|----------|--------------|
| **執行時** | 需要 `zero` 雲端服務 | 自包含，本機優先 |
| **TUI 框架** | `@opentui`（SolidJS） | `@opentui`（SolidJS），相同 |
| **Provider 層** | OpenRouter 等 | OpenCode Zen、OpenAI、OpenAI Codex、OpenRouter、Zero-API、DeepSeek，可擴充 |
| **工具系統** | 內建工具 | 檔案/搜尋/shell/編輯/web 工具 + todo + GEASS browser 工具 + 權限系統 |
| **會話儲存** | 本機檔案 | `~/.openzerocode/` 下的本機檔案 |
| **提示詞記憶** | 形態不定 | `AGENTS.md` + `CONTEXT.md` 注入本機系統提示詞 |
| **雲端依賴** | 執行需要 `zero` | 無，完全離線可用 |
| **二進位分發** | 平台專屬 npm 套件 | 平台專屬 npm 套件（`darwin-arm64`、`linux-x64`、`linux-arm64`、`win32-x64`）+ 透過 `python3 scripts/dev-install.py` 從原始碼優先本機安裝 |

---

## License

MIT，見 [LICENSE](./LICENSE)。
