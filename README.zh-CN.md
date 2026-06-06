# OpenZeroCode

语言：[English](./README.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md)

> **面向终端的 AI 编程代理，灵感来自 [OpenCode](https://github.com/sst/opencode)。**

OpenZeroCode 是一个本地优先、由 TUI 驱动的 AI 编程助手，沿着 OpenCode 的方向改造而来。它移除了对 `zero` 云服务的依赖，专注于自包含的终端体验，内置工具、多 Provider 支持和工作区记忆。

![OpenZeroCode 预览](./preview01.png)

---

## 灵感来源

本项目**深受 OpenCode 启发**。OpenCode 是终端原生 AI 编程代理。OpenZeroCode 最初延续了 OpenCode 的架构方向，之后逐步发展出自己的定位：

- **相同基础**：SolidJS 终端 UI（`@opentui`）、Provider 抽象、工具系统、会话持久化
- **不同重点**：本地优先、独立于 `zero` 生态、便于扩展自定义工作流
- **共同脉络**：Provider 注册、工具注册和构建流水线模式都继承自 OpenCode 的设计思路

感谢 OpenCode 项目的设计，本项目正是站在它的基础上诞生的。

---

## 当前状态

这个仓库仍在积极实现中。目前已具备：

- **基于 Solid 的终端 UI**：入口位于 `src/client/tui.tsx`，支持流式响应、推理展示和命令面板
- **Build / Plan 模式切换**：在结构化执行和自由探索之间切换
- **Provider 切换**：OpenCode Zen、OpenAI、OpenAI Codex、OpenRouter、Zero-API、DeepSeek，以及可配置的 OpenAI-compatible 端点
- **模型切换**：运行中切换模型
- **多会话持久化**：会话保存于 `~/.openzerocode/sessions`
- **会话管理**：重命名、删除、压缩会话，以及 timeline 操作（revert/copy/fork）
- **Headless 与 server 模式**：用 `--run` 做一次性 CLI 运行，用 `serve` 启动 streaming HTTP API
- **侧边栏上下文**：Token 用量、费用跟踪、Git diff 摘要
- **工作区提示记忆**：将 `AGENTS.md` 指令和 `CONTEXT.md` 项目上下文注入系统提示词
- **会话交接**：使用 `SESSION_SUMMARY.md` 保存简洁的本地续接笔记
- **GEASS browser 工具**：可选的浏览器导航、读取、交互、截图与视觉观察
- **16 个内置工具**：

| 工具 | 说明 |
|------|------|
| `read` | 读取文件内容 |
| `write` | 写入或覆盖文件 |
| `grep` | 按模式搜索文件内容 |
| `glob` | 按 glob 模式查找文件 |
| `bash` | 执行 shell 命令 |
| `edit` | 定向字符串替换编辑 |
| `web-fetch` | 从 URL 获取内容 |
| `todo-write` | 在多步骤工作中维护结构化任务清单 |
| `browser-navigate` | 将连接中的 GEASS browser 导航到 URL |
| `browser-read` | 读取当前 GEASS browser 页面的结构化内容 |
| `browser-click` | 点击 GEASS browser 页面元素 |
| `browser-type` | 在 GEASS browser 输入字段中输入文字 |
| `browser-select` | 选择 GEASS browser 下拉菜单选项 |
| `browser-scroll` | 滚动当前 GEASS browser 页面 |
| `browser-screenshot` | 捕获浏览器截图 |
| `browser-observe-visual` | 以视觉方式检查当前浏览器画面 |

![OpenZeroCode TUI 会话](./docs/assets/openzerocode-demo.gif)

---

## 快速开始

### 前置条件

源码开发需要 **bun** >= 1.2，以及 `PATH` 中可用的 **npm**。

### 安装脚本

Release installer 参考 opencode 的用户级安装方式：默认把二进制文件安装到 `~/.openzerocode/bin`，并在需要时更新你的 shell 配置，把该目录加入 `PATH`。

```bash
curl -fsSL https://github.com/arborlogic/openzerocode/releases/latest/download/install | bash
```

如果想手动更新 `PATH`，可使用 `--no-modify-path`；也可以设置 `OPENZEROCODE_INSTALL_DIR` 指定其他可写入的安装目录。

### 从 npm 安装

当前支持的预构建 npm 目标：

- `darwin-arm64`
- `linux-x64`
- `linux-arm64`
- `win32-x64`

安装：

```bash
npm install -g openzerocode
```

根包会安装一个很小的 Node 启动器，并在运行时解析匹配的平台可选包。

### 从源码安装

```bash
git clone https://github.com/arborlogic/openzerocode.git
cd openzerocode
python3 scripts/dev-install.py
```

这是当前支持的本地开发安装路径。它会安装依赖，使用带时间戳的 `-dev.YYYYMMDDHHMMSS` 版本后缀重新构建 `dist/openzerocode`，并执行 `npm install -g .`，让全局 `openzerocode` 命令指向本地构建的二进制文件。

### 运行

```bash
openzerocode
```

### 开发模式

```bash
npm run dev
```

### 更新

```bash
git pull
python3 scripts/dev-install.py
```

这会刷新依赖、重新构建二进制文件，并从你的本地 checkout 重新安装全局 `openzerocode` 命令。

### npm 打包流程

发布到 npm 的产物采用“根启动器 + 平台包”的结构：

- 根包 `openzerocode` 只包含 Node 启动器 `bin/openzerocode.js`
- 平台二进制文件位于 `@openzerocode/<target>` 可选依赖中
- 当前支持目标：`darwin-arm64`、`linux-x64`、`linux-arm64`、`win32-x64`

典型流程：

1. **构建本地二进制文件**

   ```bash
   npm run build
   ```

   这会运行 `scripts/build.sh`，默认输出 `dist/openzerocode`。

2. **生成 `npm/` 发布暂存结构**

   ```bash
   node scripts/create-platform-packages.mjs
   ```

   这会创建：

   - `npm/package.json`：根 npm 包 manifest
   - `npm/bin/openzerocode.js`：根据平台分发到对应二进制文件的启动器
   - `npm/packages/<target>/package.json`：各平台包 manifest
   - `npm/README.md`、`npm/LICENSE`、`npm/bin/package.json`：发布辅助文件

3. **在对应原生平台构建各平台二进制文件**

   ```bash
   scripts/build-platform-package.sh darwin-arm64
   scripts/build-platform-package.sh linux-x64
   scripts/build-platform-package.sh linux-arm64
   scripts/build-platform-package.sh win32-x64
   ```

   `scripts/build-platform-package.sh` 必须在匹配的宿主平台运行。例如，`linux-arm64` 必须在 `linux-arm64` 机器上构建。构建成功后会输出到：

   - `npm/packages/<target>/bin/openzerocode`
   - Windows 目标：`npm/packages/win32-x64/bin/openzerocode.exe`

4. **打包或发布 npm 包**

   完成暂存结构和平台二进制构建后，在 `npm/` 和各 `npm/packages/<target>/` 目录中运行 `npm pack` 或 `npm publish`。

   推荐顺序：

   - 先发布平台包 `@openzerocode/<target>`
   - 再发布根包 `openzerocode`

5. **发布检查清单**

   使用 release script 准备版本更新、changelog entry、release commit，以及匹配的 git tag：

   ```bash
   npm run release -- patch       # 或：minor、major、明确版本例如 0.4.3
   npm run release -- patch --dry-run
   npm run release -- patch --push
   ```

   Script 需要干净的 working tree，会更新 `package.json`、存在时更新 `package-lock.json`、更新 `CHANGELOG.md`，默认运行 `npm run typecheck`，提交 `chore: release v<version>`，并创建 `v<version>` tag。只有在明确想跳过 typecheck 时才使用 `--no-verify`。

   发布前后请确认：

   - 如果发布包含面向用户的变更，确认 changelog 或 release notes 已准备好
   - 如果没有传入 `--push`，请同时推送 release commit 和 tag：`git push origin HEAD && git push origin v<version>`
   - `.github/workflows/build.yml` 一律构建并上传 root/platform npm tarball，以及直接二进制 release archive（Linux/macOS 为 `.tar.gz`，Windows 为 `.zip`）
   - Tag push 会用这些 artifacts 创建匹配的 GitHub Release，并自动发布 npm 包
   - npm 发布会先发布平台包，再发布根包 `openzerocode`，已存在的版本会跳过
   - 如果 workflow 失败且只需要重新运行，请从 Actions 页面使用 `workflow_dispatch`；这种情况不需要再次 bump 版本或重新运行 release script。启用 `publish_to_npm` 可重新运行 npm 发布，或提供已有 tag 并启用 release option 来重新创建/更新 GitHub Release
   - 发布后，请从 GitHub Release artifacts 验证 `openzerocode --version`，并验证 `npm install -g openzerocode`

这种结构让 `npm install -g openzerocode` 保持轻量，同时由 npm 解析平台专属可选包中的真实可执行文件。

### 命令行用法

```bash
openzerocode                         # 启动 TUI
openzerocode --version               # 显示版本
openzerocode --help                  # 显示 CLI help
openzerocode --run "fix the tests"    # Headless 运行一次 prompt，工具自动批准
openzerocode serve --port 4096       # 启动 streaming HTTP API server
```

环境变量覆盖：

| 变量 | 作用 |
|------|------|
| `OPENZERO_MODEL` | 覆盖 headless `--run` 模式使用的默认模型 |
| `OPENZEROCODE_PROVIDER_CONFIG` | 覆盖 provider 配置文件路径（默认 `~/.openzerocode/providers.json`） |

### 备用入口

```bash
npm run start:tui
```

---

## Provider 配置

Provider 凭证可以通过环境变量或本地配置文件提供：

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

**支持的 Provider：**

| Provider id | 名称 | 环境变量 |
|-------------|------|----------|
| `opencode-zen` | OpenCode Zen | `OPENCODE_API`、`OPENCODE_API_KEY`（可选；可匿名使用免费模型） |
| `openai` | OpenAI | `OPENAI_API_KEY` |
| `openai-codex` | OpenAI Codex | 通过 `/codex-login` 使用 ChatGPT OAuth |
| `openrouter` | OpenRouter | `OPENROUTER_API_KEY` |
| `zero-api` | Zero-API-compatible local endpoint | `ZERO_API_KEY` |
| `deepseek` | DeepSeek | `DEEPSEEK_API_KEY` |

**说明：**

- 每个 Provider 可以有多个命名 key。
- `activeKey` 决定运行时使用该 Provider 的哪个 key。
- `baseURL` 可以覆盖 Provider 的默认端点，供 compatible API 使用。
- 配置文件中的值优先级高于环境变量。
- 可以在 TUI 中通过斜杠命令和 command palette 查看或切换 Provider、模型和 key。

---

## 开发

```bash
# 类型检查
npm run typecheck

# 运行所有单元测试（排除 Provider 集成测试）
npm run test:unit

# 运行单个测试文件
npx tsx --test src/client/workspace-memory.test.ts
```

更多说明见 [DEVELOPMENT.md](./DEVELOPMENT.md)，包括：

- 构建独立二进制文件
- 跨平台分发
- 构建系统与 `Bun.build()` 编译

---

## 架构

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

## 工作区记忆模型

OpenZeroCode 将仓库记忆拆分为三个轻量文件：

- `AGENTS.md`：稳定的仓库专属指令、工作流和约束。
- `CONTEXT.md`：背景上下文、共享词汇，以及值得在提示词中暴露的已知不一致。
- `SESSION_SUMMARY.md`：给人类或后续续接用的简短交接笔记；不会自动注入系统提示词。

当前自动提示词组装路径会通过 `src/client/workspace-memory.ts` 从最近的工作区加载 `AGENTS.md` 和 `CONTEXT.md`。

### 关键源码文件

| 文件 | 用途 |
|------|------|
| `src/client/tui.tsx` | 主 TUI 入口和 UI 编排 |
| `src/client/sessions.ts` | 会话持久化辅助逻辑 |
| `src/client/workspace-memory.ts` | 将 `AGENTS.md` 和 `CONTEXT.md` 加载进系统提示词 |
| `SESSION_SUMMARY.md` | 手动会话交接和续接笔记 |
| `src/provider/registry.ts` | Provider 注册和解析 |
| `src/tool/registry.ts` | 内置工具注册 |
| `src/server/index.ts` | `openzerocode serve` 使用的 streaming HTTP API server |

---

## 与 OpenCode 的关系

| 方面 | OpenCode | OpenZeroCode |
|------|----------|--------------|
| **运行时** | 需要 `zero` 云服务 | 自包含，本地优先 |
| **TUI 框架** | `@opentui`（SolidJS） | `@opentui`（SolidJS），相同 |
| **Provider 层** | OpenRouter 等 | OpenCode Zen、OpenAI、OpenAI Codex、OpenRouter、Zero-API、DeepSeek，可扩展 |
| **工具系统** | 内置工具 | 文件/搜索/shell/编辑/web 工具 + todo + GEASS browser 工具 + 权限系统 |
| **会话存储** | 本地文件 | `~/.openzerocode/` 下的本地文件 |
| **提示词记忆** | 形态不定 | `AGENTS.md` + `CONTEXT.md` 注入本地系统提示词 |
| **云依赖** | 运行需要 `zero` | 无，完全离线可用 |
| **二进制分发** | 平台专属 npm 包 | 平台专属 npm 包（`darwin-arm64`、`linux-x64`、`linux-arm64`、`win32-x64`）+ 通过 `python3 scripts/dev-install.py` 从源码优先本地安装 |

---

## License

MIT，见 [LICENSE](./LICENSE)。
