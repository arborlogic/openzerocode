# OpenZeroCode

语言：[English](./README.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md)

> **面向终端的 AI 编程代理，灵感来自 [OpenCode](https://github.com/sst/opencode)。**

OpenZeroCode 是一个本地优先、由 TUI 驱动的 AI 编程助手，沿着 OpenCode 的方向改造而来。它移除了对 `zero` 云服务的依赖，专注于自包含的终端体验，内置工具、多 Provider 支持和工作区记忆。

![OpenZeroCode 预览](./preview01.png)

---

## 灵感来源

本项目**深受 OpenCode 启发**。OpenCode 是 [SST](https://sst.dev) 构建的终端原生 AI 编程代理。OpenZeroCode 最初延续了 OpenCode 的架构方向，之后逐步发展出自己的定位：

- **相同基础**：SolidJS 终端 UI（`@opentui`）、Provider 抽象、工具系统、会话持久化
- **不同重点**：本地优先、独立于 `zero` 生态、便于扩展自定义工作流
- **共同脉络**：Provider 注册、工具注册和构建流水线模式都继承自 OpenCode 的设计思路

感谢 OpenCode 项目的设计，本项目正是站在它的基础上诞生的。

---

## 当前状态

这个仓库仍在积极实现中。目前已具备：

- **基于 Solid 的终端 UI**：入口位于 `src/client/tui.tsx`，支持流式响应、推理展示和命令面板
- **Build / Plan 模式切换**：在结构化执行和自由探索之间切换
- **Provider 切换**：使用你自己的 API Key（OpenRouter、自定义端点等）
- **模型切换**：运行中切换模型
- **多会话持久化**：会话保存于 `~/.openzerocode/sessions`
- **会话管理**：重命名、删除、压缩会话
- **侧边栏上下文**：Token 用量、费用跟踪、Git diff 摘要
- **工作区提示记忆**：将 `AGENTS.md` 指令和 `CONTEXT.md` 项目上下文注入系统提示词
- **会话交接**：使用 `SESSION_SUMMARY.md` 保存简洁的本地续接笔记
- **7 个内置工具**：

| 工具 | 说明 |
|------|------|
| `read` | 读取文件内容 |
| `write` | 写入或覆盖文件 |
| `grep` | 按模式搜索文件内容 |
| `glob` | 按 glob 模式查找文件 |
| `bash` | 执行 shell 命令 |
| `edit` | 定向字符串替换编辑 |
| `web-fetch` | 从 URL 获取内容 |

![OpenZeroCode TUI 会话](./snapshot01.png)

---

## 快速开始

### 前置条件

- **bun** >= 1.2
- `PATH` 中可用的 **npm**（用于开发安装流程和 npm 分发）

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

5. **CI / 发布检查清单**

   发布前后请确认：

   - 更新根目录 `package.json` / `package-lock.json` 版本，并创建匹配的 git tag，例如包版本 `0.3.2` 对应 tag `v0.3.2`
   - 如果发布包含面向用户的变更，确认 changelog 或 release notes 已准备好
   - 运行 `npm run typecheck`
   - 重新运行 `node scripts/create-platform-packages.mjs`，确认 `npm/` 和 `npm/packages/<target>/` 下的暂存文件是最新的
   - 合并到 `main`，然后推送 `v*` tag 触发 GitHub Actions 发布流程
   - `.github/workflows/build.yml` 当前会在 tag push 时构建平台包、发布各 `@openzerocode/<target>`，并创建匹配的 GitHub Release
   - 工作流目前还不会自动发布根包 `openzerocode`；若要让 `npm install -g openzerocode` 可用，仍需从 `npm/` 手动发布根包
   - 发布后，在干净环境中验证 `npm install -g openzerocode` 和 `openzerocode --version`

这种结构让 `npm install -g openzerocode` 保持轻量，同时由 npm 解析平台专属可选包中的真实可执行文件。

### 命令行参数

| 参数 | 作用 |
|------|------|
| `--build` | 以 build 模式启动 |
| `--plan` | 以 plan 模式启动 |
| `--model <name>` | 覆盖默认模型 |
| `--provider <name>` | 覆盖默认 Provider |

### 备用入口

```bash
npm run start:tui
```

---

## Provider 配置

Provider 凭证可以写入本地配置文件：

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
      }
    }
  }
}
```

**说明：**

- 每个 Provider 可以有多个命名 key。
- `activeKey` 决定运行时使用该 Provider 的哪个 key。
- 配置文件中的值优先级高于环境变量。
- 可以在 TUI 中使用这些斜杠命令查看和切换 key：
  - `/provider-key path`
  - `/provider-key list <provider>`
  - `/provider-key use <provider> <key-name>`

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
│  - working memory injection                    │
└────────┬───────────────────────────────────────┘
         │
         ├── provider layer ─────────────────────┐
         │  src/provider/registry.ts             │
         │  - OpenRouter (openrouter)            │
         │  - Big Pickle (big-pickle)            │
         │  - Extensible via registry            │
         └───────────────────────────────────────┘
         │
         └── tool layer ─────────────────────────┐
            src/tool/registry.ts                 │
            - read / write / grep / glob         │
            - bash / edit / web-fetch            │
            - Permission system                  │
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

---

## 与 OpenCode 的关系

| 方面 | OpenCode | OpenZeroCode |
|------|----------|--------------|
| **运行时** | 需要 `zero` 云服务 | 自包含，本地优先 |
| **TUI 框架** | `@opentui`（SolidJS） | `@opentui`（SolidJS），相同 |
| **Provider 层** | OpenRouter 等 | OpenRouter、Big Pickle，可扩展 |
| **工具系统** | 内置工具 | 同样的 7 个工具 + 权限系统 |
| **会话存储** | 本地文件 | `~/.openzerocode/` 下的本地文件 |
| **提示词记忆** | 形态不定 | `AGENTS.md` + `CONTEXT.md` 注入本地系统提示词 |
| **云依赖** | 运行需要 `zero` | 无，完全离线可用 |
| **二进制分发** | 平台专属 npm 包 | 平台专属 npm 包（`darwin-arm64`、`linux-x64`、`linux-arm64`、`win32-x64`）+ 通过 `python3 scripts/dev-install.py` 从源码优先本地安装 |

---

## License

MIT，见 [LICENSE](./LICENSE)。
