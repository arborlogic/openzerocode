# OpenZeroCode 安裝與發布缺口及解決方案

> 本文件根據目前 repository 的 installer、npm packaging、binary build 與 GitHub Actions 程式碼盤點而成。目標不是立即改寫所有流程，而是先定義一個可分階段落地、可驗證且不破壞既有使用者安裝的方案。

## 1. 現況摘要

目前同時存在三條分發路徑：

1. **Release installer**：`install` 從 GitHub Release 下載對應平台 archive，預設安裝到 `~/.openzerocode/bin`。
2. **npm**：根套件是 Node launcher，透過 optional dependency 解析 `@openzerocode/<target>` 平台套件。
3. **本機開發安裝**：`python3 scripts/dev-install.py` 建置 `dist/openzerocode` 後，以 `npm install -g .` 安裝。

支援目標目前固定為：

- `darwin-arm64`
- `linux-x64`
- `linux-arm64`
- `win32-x64`

bundled skills 目前採獨立的 `bundled-skills/` 管理目錄，升級時替換該目錄，保留使用者自行建立的 `skills/`。

## 2. 已發現的缺口

### P0：安全與升級可靠性

#### 2.1 Release artifact 沒有完整性或來源驗證

`install` 使用 `curl` 下載 archive 後直接解壓並安裝，沒有 checksum、簽章、SLSA provenance 或 pinned commit 驗證。即使 HTTPS 正常，也無法偵測 Release artifact 被替換、代理層污染或錯誤版本內容。

**影響**：installer 是一條可直接覆蓋本機 executable 的供應鏈入口。

#### 2.2 installer 不是原子升級

`install_file()` 直接 `cp` 到最終路徑；bundled skills 則先 `rm -rf` 再 `cp -R`。下載或複製中途失敗時，可能留下半套 binary 或空的 skills 目錄。

**影響**：更新失敗後，既有可工作的版本可能無法啟動或缺少內建 skills。

#### 2.3 archive 解壓缺少路徑安全檢查

installer 以 `tar -xzf` / `unzip` 直接解壓，再用 `find` 尋找 binary。沒有先驗證 archive entry 是否為預期目錄、是否含有 `..` 或絕對路徑，也沒有明確限制解壓檔案數量與大小。

**影響**：Release artifact 若遭竄改，可能寫入暫存目錄外的檔案，或造成資源消耗。

### P1：平台與發布流程一致性

#### 2.4 平台支援矩陣不完整且由多處手動維護

平台清單分散在：

- `install`
- `scripts/build-platform-package.sh`
- `scripts/create-platform-packages.mjs`
- `.github/workflows/build.yml`
- README

目前沒有 `darwin-x64`、Windows ARM64、Linux musl 等目標；新增平台必須同步修改多個檔案，容易出現「CI 有建置但 installer/launcher 不認得」的情況。

#### 2.5 dev publish 與正式 npm publish 的產物模型不同

`.github/workflows/publish-dev.yml` 只修改 root `package.json` 後執行 `bun publish --tag dev`，沒有產生或建置各平台套件，也沒有依序發布 `@openzerocode/<target>`。因此 dev tag 的 root package 可能引用不存在或不匹配版本的 optional dependencies。

#### 2.6 root package 的端到端驗證不足

CI 會 pack root/platform tarball，但沒有在乾淨、隔離的 temporary project 中安裝 tarball，逐一驗證：

- optional dependency 是否被正確解析
- launcher 是否找到正確 binary
- `openzerocode --version` 是否成功
- unsupported platform 是否輸出可理解錯誤
- bundled skills 是否跟著 platform package 到達執行檔旁

現有 `test:packaging` 偏向檔案與 installer smoke test，不能完全覆蓋真實 npm install 行為。

#### 2.7 版本來源分散

binary 版本由 `scripts/version.ts` 注入，npm manifest 版本由 `package.json` 產生，Release archive 檔名又由 workflow 讀取 `package.json`。目前缺少一個產物 manifest 將版本、tag、target、git SHA、build time、checksum 綁在一起。

**影響**：出現「檔名版本、binary `--version`、npm 版本」不一致時，除人工檢查外沒有可靠追蹤方式。

### P1：使用者體驗與可維運性

#### 2.8 installer 對 shell 與作業系統的處理仍脆弱

installer 以 `uname` 和 shell 字串判斷平台，Windows 依賴 Git Bash/MSYS/Cygwin；對 PowerShell、原生 Windows terminal、Rosetta、container/CI 等情境沒有正式行為定義。PATH 修改也只在找到既有 config 檔時寫入，沒有明確的 dry-run 或 rollback 機制。

#### 2.9 安裝前後缺少明確診斷資訊

失敗訊息沒有統一包含 target、version、URL、預期 checksum、安裝目錄與 rollback 狀態；launcher 對 optional dependency 缺失已有基本錯誤，但 installer 與 npm 安裝的診斷格式不一致。

#### 2.10 沒有正式 rollback/uninstall 規格

目前 installer 直接覆蓋版本，沒有 current/versions symlink 或保留上一版的標準目錄，也沒有官方 uninstall 命令與使用者資料保留政策。

## 3. 建議目標架構

### 3.1 單一 target manifest

新增 `packaging/targets.json`，作為唯一來源：

```json
{
  "targets": [
    { "id": "darwin-arm64", "os": "darwin", "arch": "arm64", "binary": "openzerocode", "archive": "tar.gz", "runner": "macos-15" }
  ]
}
```

由 script 產生：

- npm optional dependencies 與平台 package manifests
- launcher target map
- installer target mapping
- CI matrix
- README 的支援矩陣（或至少在 CI 檢查 README 與 manifest 一致）

### 3.2 可驗證的 release manifest

每個 GitHub Release 產出 `manifest.json`，至少包含：

- version、tag、git SHA
- target、archive filename、binary filename
- SHA-256 checksum、檔案大小
- bundled skills tree checksum
- build runner 與 Bun 版本

installer 下載 archive 後必須先驗證 manifest 與 checksum，再解壓。第二階段可加入 Sigstore/Cosign 簽章；在此之前至少完成 checksum 驗證與 HTTPS URL allowlist。

### 3.3 staged + atomic install

建議安裝目錄改為：

```text
~/.openzerocode/
├── bin/openzerocode -> ../versions/0.8.5/openzerocode
├── current -> versions/0.8.5
├── versions/0.8.4/
├── versions/0.8.5/
├── bundled-skills/          # 由目前版本管理
└── skills/                  # 使用者資料，永不由升級刪除
```

升級流程：

1. 建立同一 filesystem 的暫存目錄。
2. 下載、checksum 驗證、safe extract。
3. 驗證 binary 可執行、`--version` 等於目標版本、bundled skills 必要檔存在。
4. 將完整目錄 rename 到 `versions/<version>`。
5. 以 atomic rename 更新 `current` / `bin/openzerocode`。
6. 驗證失敗時刪除 staging，保留舊版不變。
7. 保留最近 N 個版本，提供 `--rollback <version>`。

若為了相容現有 `OPENZEROCODE_INSTALL_DIR`，第一階段可維持平面目錄，但至少要使用 `.staging-*` + rename，並先建立 `bundled-skills.new` 後再交換。

### 3.4 統一 npm 與 Release installer 的產物驗證

同一個 platform build 應產出：

- platform npm package
- direct binary archive
- release manifest entry

兩者都必須包含相同 binary build ID 與 bundled skills checksum。CI 不應重新建置第二份 binary，避免 npm 與 GitHub Release 內容漂移。

### 3.5 正式支援矩陣與失敗策略

短期維持目前四個 target，但明確定義：

- 不支援的 target 在 installer 與 launcher 都回傳 exit code 1、target、可用替代安裝方式。
- Windows 原生 PowerShell installer 另提供 `.ps1`，或明確將 Bash/MSYS 列為必要前置條件。
- 每個 target 至少在對應 runner 執行 smoke test。
- 新增 target 必須只改 manifest 與 runner 設定，不再散落修改多個 mapping。

## 4. 建議實作分期

### Phase 1：先修可靠性（低風險）

1. 增加 `manifest.json` 與 SHA-256，installer 強制驗證。
2. installer 使用 staging directory 與 atomic rename。
3. 增加 binary `--version`、bundled skills、檔案權限與 archive entry 的驗證。
4. 統一錯誤訊息與 `--verbose` / `--dry-run`。
5. 補上 installer failure test：下載失敗、checksum 不符、版本不符、升級中斷後舊版仍可用。

### Phase 2：統一 packaging pipeline

1. 建立 `packaging/targets.json`。
2. 由 manifest 生成 npm package metadata、launcher mapping、CI matrix。
3. dev publish 先生成並發布所有 platform packages，再發布 root package；使用獨立 dev version，確保 optional dependency 版本完全一致。
4. CI 在 temporary HOME/project 執行 `npm install`，驗證 root launcher 與 platform binary。
5. 產物加入 build ID 與 manifest，避免 binary/archive/npm 版本漂移。

### Phase 3：安全與維運能力

1. 使用 Sigstore/Cosign 對 manifest 與 archives 簽章。
2. installer 支援 rollback、保留版本清理與 uninstall。
3. 提供 PowerShell installer 或正式記錄 Windows 安裝支援範圍。
4. 建立 release dashboard/checklist：每個 target 的 build、checksum、install、version smoke test 狀態。

## 5. 驗收標準

### Installer

- checksum 不符時不會改動目前安裝版本。
- 任一下載、解壓、驗證失敗都能清理 staging。
- 升級中斷後，`openzerocode --version` 仍回傳升級前版本。
- bundled skills 會完整替換；使用者 `skills/` 不會被刪除。
- `--version`、`OPENZEROCODE_INSTALL_DIR`、`--no-modify-path` 在 macOS/Linux/Windows Bash 行為有測試覆蓋。

### npm

- 四個 target 都能在乾淨 temporary project `npm install -g` 或 local prefix install。
- launcher 能找到 binary，`openzerocode --version` 與 package version 相同。
- 缺少 optional dependency 時輸出 target、package name 與修復指令。
- dev、正式 release 都遵守相同的 root + platform package 版本關係。

### Release

- 每個 tag 只由同一批 build artifacts 產生 npm tarball、direct archive 與 manifest。
- CI 驗證所有 target 的 binary、skills、checksum 與 smoke test。
- Release 重跑不會因已存在的 npm version 或 GitHub Release 造成不可診斷失敗。
- release log 可由 tag 反查 git SHA、target、runner、Bun 版本與 checksum。

## 6. 建議優先順序

若只能先做一輪，優先順序是：

1. **checksum + staged atomic install**：直接降低供應鏈與升級失敗風險。
2. **npm temporary-install E2E test**：確認目前最容易被忽略的 root/platform 整合。
3. **single target manifest**：降低後續新增平台與維護 CI 的成本。
4. **修正 dev publish**：避免測試版安裝取得不一致的 optional dependencies。
5. **rollback/uninstall/signing**：在前述基礎穩定後再加入。

## 7. 對現有程式碼的對應修改範圍

| 區域 | 目前檔案 | 建議變更 |
| --- | --- | --- |
| Installer | `install` | checksum、safe extract、staging、atomic swap、rollback |
| Installer tests | `scripts/install.test.ts` | failure/rollback/path/platform cases |
| Target mapping | `scripts/build-platform-package.sh`, `scripts/create-platform-packages.mjs`, workflow | 改讀 `packaging/targets.json` |
| npm launcher | 生成的 `npm/bin/openzerocode.js` | 加入 build ID、診斷與一致的錯誤碼 |
| npm E2E | `scripts/*test.ts` 或新增 `scripts/npm-install.test.ts` | temporary project 安裝與執行驗證 |
| Dev publishing | `.github/workflows/publish-dev.yml` | 生成、建置、發布 platform packages，再發布 root |
| Release workflow | `.github/workflows/build.yml` | 產出 manifest、checksum，重用同一 binary artifacts |
| 文件 | `README*.md` | 以 target manifest 及實際支援的 installer 行為更新 |

## 結論

目前程式已具備可用的基本分發骨架，但「能建置」與「可安全、可重試、可追蹤地安裝」仍是兩個不同層次。最務實的路線是先保留既有三種安裝方式，補上 artifact 驗證與 atomic install，再把 target metadata、npm E2E 和 dev/release pipeline 收斂到同一個產物模型。這樣可以在不要求使用者立刻改變安裝指令的前提下，逐步降低發布與升級風險。
