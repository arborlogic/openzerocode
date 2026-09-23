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

- **基於 Solid 的終端機 UI**：入口位於 `src/client/tui.tsx`，支援串流回應、推理展示、命令面板、輸入佇列、steering，以及長會話渲染控制
- **Build / Plan / Compose 三種模式**：直接實作、唯讀檢查/規劃，以及由 skills 驅動的 spec / TDD / verify / review 工作流程
- **Productive / Lite harness**：預設完整 agent harness，以及為較小型本地模型縮減 prompt 與工具面的 Lite profile
- **Provider 切換**：OpenCode Zen、OpenAI、OpenAI Codex、xAI OAuth、OpenRouter、Zero-API、DeepSeek，以及原生 Ollama
- **模型與 reasoning 切換**：執行中切換模型，並可用 `/reasoning` 設定模型支援的 reasoning effort
- **多會話持久化**：會話儲存於 `~/.openzerocode/sessions`
- **會話管理**：重新命名、刪除、壓縮、匯出、timeline 操作（revert/copy/fork）與自動 context compression
- **Autopilot**：`standard` 處理例行續接；`goal` 可在已核准目標範圍內跨回合推進工作
- **Skills**：支援 bundled、project 與 user-global `SKILL.md`，並可啟用每次請求的自動 skill routing；Compose 另有結構化 skill workflow
- **Headless 與 server 模式**：用 `--run` 做一次性 CLI 執行，用 `serve` 啟動 streaming HTTP API
- **Peer collaboration**：具名的本機 OpenZeroCode process 可互相發現與呼叫，並具備 hop / round-trip 限制
- **MCP tools**：可載入設定過的 MCP server，並作為可選的動態 tool group
- **Prompt memory**：只有 user-global `~/.openzerocode/AGENTS.md` 與 `~/.openzerocode/CONTEXT.md` 會在非空時自動注入 prompt
- **Learnings**：`/learn` 透過 `compose:learn`，將專案學習寫入 `docs/compose/learnings/PROJECT.md`，跨專案學習寫入 `~/.openzerocode/LEARNINGS.md`
- **會話交接**：專案內的 `SESSION_SUMMARY.md` 是手動交接文件，不會自動注入 prompt
- **GEASS browser + vision 工具**：可選的瀏覽器導覽/互動、截圖、原生模型 vision 與 local-VLM fallback
- **19 個內建工具**：

| 工具 | 說明 |
|------|------|
| `read` | 讀取檔案內容 |
| `write` | 寫入或覆寫檔案 |
| `grep` | 依模式搜尋檔案內容 |
| `glob` | 依 glob 模式尋找檔案 |
| `bash` | 執行 shell 命令 |
| `edit` | 定向字串替換編輯 |
| `apply_patch` | 以 patch 格式新增、更新或刪除檔案 |
| `web_fetch` | 從 URL 取得內容 |
| `todowrite` | 在多步驟工作中維護結構化任務清單 |
| `browser_navigate` | 將連線中的 GEASS browser 導覽到 URL |
| `browser_read` | 讀取目前 GEASS browser 頁面的結構化內容 |
| `browser_click` | 點擊 GEASS browser 頁面元素 |
| `browser_type` | 在 GEASS browser 輸入欄位中輸入文字 |
| `browser_select` | 選取 GEASS browser 下拉選單選項 |
| `browser_scroll` | 捲動目前 GEASS browser 頁面 |
| `browser_screenshot` | 擷取瀏覽器截圖 |
| `browser_observe_visual` | 視覺檢查目前 browser 畫面，必要時可使用 local VLM |
| `analyze_image` | 透過原生模型 vision 或 local-VLM fallback 分析圖片 |
| `call_peer` | 將任務或訊息傳給另一個具名的本機 OpenZeroCode peer |

MCP tools 會在執行時動態註冊，因此不包含在上述 19 個內建工具計數中。

![OpenZeroCode TUI 會話](./docs/assets/openzerocode-demo.gif)

---

## 快速開始

### 前置條件

原始碼開發需要 **bun** >= 1.2，以及 `PATH` 中可用的 **npm**。

#### Linux 剪貼簿支援

OpenZeroCode 在 Linux 上會透過系統剪貼簿工具進行複製與貼上。請依桌面工作階段安裝對應套件：

- **Wayland**（包含使用 Wayland 工作階段的 Kubuntu）：`wl-clipboard`
- **X11/Xorg**：`xclip` 或 `xsel`

Debian、Ubuntu 或 Kubuntu 可使用：

```bash
# Wayland
sudo apt install wl-clipboard

# X11/Xorg（擇一安裝）
sudo apt install xclip
# 或：sudo apt install xsel
```

OpenZeroCode 會依目前的工作階段，按適當順序嘗試 Wayland 與 X11 工具。WSL 則會在可用時透過 `clip.exe` 與 PowerShell 使用 Windows 剪貼簿。

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

這是目前支援的本機開發安裝路徑。它會安裝依賴，使用帶時間戳的 `-dev.YYYYMMDDHHMMSS` 版本後綴重新建置 `dist/openzerocode`，並執行 `npm install -g .`，讓全域 `openzerocode` 命令指向本機建置的二進位檔。內建 skills 會包含在安裝套件中，並部署在二進位檔旁。

### 執行

```bash
openzerocode
```

### 開發模式

```bash
npm run dev
```

### 更新

OpenZeroCode 目前不會自行更新，也不會在背景下載更新。使用者必須依照原本的安裝方式手動更新。

**安裝腳本：**重新執行安裝程式，以最新的 GitHub Release 取代已安裝的二進位檔：

```bash
curl -fsSL https://github.com/arborlogic/openzerocode/releases/latest/download/install | bash
```

如果安裝時有設定 `OPENZEROCODE_INSTALL_DIR`，更新時請指定相同的目錄。

**npm：**全域安裝最新發布版本：

```bash
npm install -g openzerocode@latest
```

**原始碼 checkout：**拉取最新原始碼，並重新建置本機開發安裝：

```bash
git pull
python3 scripts/dev-install.py
```

這會更新依賴、重新建置二進位檔，並從你的本機 checkout 重新安裝全域 `openzerocode` 命令。

更新後可使用以下命令確認已安裝的版本：

```bash
openzerocode --version
```

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
openzerocode --name backend          # 以具名 local peer 啟動 TUI
```

環境變數覆寫：

| 變數 | 作用 |
|------|------|
| `OPENZERO_MODEL` | 覆寫 headless `--run` 模式使用的預設模型 |
| `OPENZEROCODE_PROVIDER_CONFIG` | 覆寫 provider 設定檔路徑（預設 `~/.openzerocode/providers.json`） |
| `OPENZEROCODE_HARNESS_PROFILE` | `productive`（預設）或 `lite`；Lite 會縮小 prompt 與 tool surface，適合較小型本地模型 |
| `OPENZEROCODE_MAX_STEPS` | 覆寫每次 run 最大 model/tool round-trip 數（預設 50） |

常用 TUI 命令：

| 命令 | 用途 |
|------|------|
| `/mode build\|plan\|compose` | 切換執行模式 |
| `/reasoning low\|medium\|high\|xhigh\|max\|off` | 設定目前模型支援的 reasoning effort |
| `/autopilot standard\|goal\|off` | 設定自動續接模式 |
| `/steer <instruction>` | 在下一個安全 model boundary 對目前 active run 加入指示 |
| `/skills auto` / `/skills clear` | 啟用或停用自動 skill routing |
| `/skill <name>` | 查看某個 skill 的 instructions |
| `/learn` | 透過 `compose:learn` 擷取可重用的非顯而易見學習 |
| `/compact` / `/export` | 壓縮歷史或匯出 compact transcript |
| `/peers` / `/call <name> <prompt>` | 查看或呼叫具名 local peers |
| `/usage` | 開啟 token usage dashboard |

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
| `xai-oauth` | xAI Grok OAuth | 透過 `/xai-login` 使用 SuperGrok / X Premium+ OAuth |
| `openrouter` | OpenRouter | `OPENROUTER_API_KEY` |
| `zero-api` | Zero-API-compatible local endpoint | `ZERO_API_KEY` |
| `deepseek` | DeepSeek | `DEEPSEEK_API_KEY` |
| `ollama` | 原生 Ollama API | 不需要 key；預設 `http://localhost:11434` |

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
┌─ TUI client ─────────────────────────────────────┐
│  src/client/tui.tsx                              │
│  - transcript / streaming / queue / steering     │
│  - sessions / compaction / timeline / usage      │
│  - build / plan / compose modes                   │
│  - Autopilot / skills / peers / tool groups       │
└────────┬─────────────────────────────────────────┘
         │
         ├── session runner ────────────────────────┐
         │  src/client/session-runner.ts            │
         │  - context budgeting + provider retries  │
         │  - tool loop + permission callbacks      │
         │  - Build/Plan tool filtering             │
         └──────────────────────────────────────────┘
         │
         ├── provider layer ────────────────────────┐
         │  src/provider/registry.ts                │
         │  - Zen / OpenAI / Codex / xAI            │
         │  - OpenRouter / Zero-API / DeepSeek      │
         │  - native Ollama                          │
         └──────────────────────────────────────────┘
         │
         └── tool layer ────────────────────────────┐
            src/tool/registry.ts                    │
            - 19 built-in tools                     │
            - optional GEASS browser + peer groups  │
            - dynamically loaded MCP tools          │
            └───────────────────────────────────────┘
```

## Prompt 記憶模型

OpenZeroCode 將長期 prompt memory 保持在 user-global，並刻意維持精簡：

- `~/.openzerocode/AGENTS.md`：跨專案的個人偏好、語言/回覆風格與一般規則；非空時自動載入。
- `~/.openzerocode/CONTEXT.md`：使用者背景、常用工具與長期上下文；非空時自動載入。
- `~/.openzerocode/LEARNINGS.md`：`compose:learn` 可建立的跨專案 learning artifact；不屬於一般自動 prompt-memory 注入路徑。
- `docs/compose/learnings/*.md`：Compose mode 在存在時會載入的 project learnings；和全域 `AGENTS.md` / `CONTEXT.md` 是不同機制。
- `SESSION_SUMMARY.md`：給人類或後續續接用的 project handoff；不會自動注入系統提示詞。

Project 內自己的 `AGENTS.md` / `CONTEXT.md` 只視為一般 repo 文件，不會自動注入；`memory.d` 也不會條件式自動載入。

舊的 `/mode learn` 已在 0.7.0 移除。現在 learning 由 bundled `compose:learn` skill 負責；`/learn` 會送出 learning extraction request，將 project-specific discovery 寫到 `docs/compose/learnings/PROJECT.md`，跨 project discovery 寫到 `~/.openzerocode/LEARNINGS.md`。

Compose mode 也會自動載入 `docs/compose/learnings/` 下的 Markdown 文件。這是 Compose 專用 learning context，和一般 global prompt memory 分開。

### 關鍵原始碼檔案

| 檔案 | 用途 |
|------|------|
| `src/client/tui.tsx` | 主 TUI 入口和 UI 編排 |
| `src/client/session-runner.ts` | Streaming agent loop、context budgeting、重試、tool execution 與 mode-specific tool filtering |
| `src/client/sessions.ts` | 會話持久化輔助邏輯 |
| `src/client/workspace-memory.ts` | 將 user-global `AGENTS.md` / `CONTEXT.md` 載入系統提示詞並回報 memory 狀態 |
| `src/client/skill-loader.ts` / `skill-routing.ts` | Skill discovery 與每次請求的自動 routing |
| `src/client/autopilot.ts` | Standard/Goal Autopilot 的 continuation 決策與 retry policy |
| `SESSION_SUMMARY.md` | 手動會話交接和續接筆記 |
| `src/provider/registry.ts` | Provider 註冊和解析 |
| `src/tool/registry.ts` | 內建工具註冊 |
| `src/mcp/` | MCP 設定、process transport、adapter 與 dynamic tool store |
| `src/peer/` | 具名 local peer 註冊、bounded collaboration 與 peer server |
| `src/server/index.ts` | `openzerocode serve` 使用的 streaming HTTP API server |

---

## 與 OpenCode 的關係

| 方面 | OpenCode | OpenZeroCode |
|------|----------|--------------|
| **執行時** | 需要 `zero` 雲端服務 | 自包含，本機優先 |
| **TUI 框架** | `@opentui`（SolidJS） | `@opentui`（SolidJS），相同 |
| **Provider 層** | OpenRouter 等 | OpenCode Zen、OpenAI、OpenAI Codex、xAI OAuth、OpenRouter、Zero-API、DeepSeek、Ollama |
| **工具系統** | 內建工具 | 19 個 built-in + 可選 GEASS/peer groups + dynamic MCP tools + permission system |
| **會話儲存** | 本機檔案 | `~/.openzerocode/` 下的本機檔案 |
| **提示詞記憶** | 形態不定 | user-global `AGENTS.md` + `CONTEXT.md` 注入本機系統提示詞 |
| **雲端依賴** | 執行需要 `zero` | 不依賴 `zero`；可用雲端 provider，也可透過 Ollama 等方式本機執行 |
| **二進位分發** | 平台專屬 npm 套件 | 平台專屬 npm 套件（`darwin-arm64`、`linux-x64`、`linux-arm64`、`win32-x64`）+ 透過 `python3 scripts/dev-install.py` 從原始碼優先本機安裝 |

---

## License

MIT，見 [LICENSE](./LICENSE)。
