# Auto-Approve 權限設計

本文件記錄 auto-approve 機制的設計決策，不是討論稿。

---

## Motivation

目前所有 write/edit/bash 操作都需要使用者在 TUI 按 `y` 才能放行。這在密集開發時會造成大量中斷。目標是：

1. 讓使用者可以開啟 auto-approve 減少互動中斷
2. 同時防止 LLM 任意執行 destructive 指令造成資料刪除

---

## Threat Model

### 哪些操作可以刪除資料？

| 工具 | 可刪除？ | 風險向量 |
|------|---------|---------|
| `read` | ❌ 唯讀 | 無 |
| `grep` | ❌ 唯讀 | 無 |
| `glob` | ❌ 唯讀 | 無 |
| `web-fetch` | ❌ 唯讀 | 無 |
| `write` | ⚠️ 可覆蓋 | 但只影響單一檔案，風險可控 |
| `edit` | ⚠️ 可字串取代 | 目標明確，不易造成大規模刪除 |
| `bash` | ✅ **可完全刪除** | `rm -rf /`、`rm file/*`、`truncate` 等 |

**結論：唯一需要保護的路徑是 `bash` 執行 destructive shell 指令。**

---

## 設計原則

1. **Defense in depth** — auto-approve 不應該讓 destructive bash 繞過審核
2. **最小變動** — 不影響 tool layer、provider layer、core layer
3. **Pattern 為白名單制** — 只擋明確危險的指令，其餘自動放行
4. **使用者永遠有最終決定權** — 被擋的指令按 `y` 仍可執行
5. **False negative 優於 false positive** — 漏擋比誤擋危險，所以 pattern 寧可寬不要窄

---

## 架構變動

### 影響的檔案

```
src/client/permission-rules.ts   ← 新增危險指令偵測
src/client/tui.tsx               ← 新增 auto-approve toggle + 修改 ask 流程
src/client/commands.ts           ← 可選：新增 /auto 指令
```

### 不影響的檔案

```
src/tool/*                        ← 工具層不變
src/provider/*                    ← provider 層不變
src/core/*                        ← core 層不變
src/client/session-runner.ts      ← session-runner 不變
```

---

## 危險指令偵測 `permission-rules.ts`

### 判斷邏輯

bash 指令傳入時，檢查是否包含 destructive pattern：

```typescript
// 只檢查指令「開頭」是否為危險指令
// 不追蹤變數、不解析管線、不做語法樹
// 目的是擋住最常見的直接刪除呼叫

DESTRUCTIVE_BASH_PATTERNS = [
  /^rm\s/,           // rm file, rm -rf /
  /^rmdir\s/,        // rmdir directory
  /^mv\s/,           // mv file /dev/null
  /^truncate\s/,     // truncate -s 0 file
  /^shred\s/,        // shred file
  /^dd\s/,           // dd if=/dev/zero of=file
  /^>/,              // > file (shell truncation)
]
```

### 不處理的 case

- `VAR=val rm file` → 有 variable assignment prefix，需 normalize
- `sudo rm file` → 前面有 sudo，需 normalize
- `find . -exec rm {} \;` → 較間接，pattern 難涵蓋所有變形
- `alias rm='rm -i'` → 使用者自訂 alias，無法靜態分析

對於上述 case：**寧可漏擋（false negative）也要避免誤擋 safe 指令（false positive）**。如果使用者開啟 auto-approve 後遇到漏擋的危險指令，LLM 會執行它。這是設計上的取捨：auto-approve 本身就有風險，我們只提供基本防護，不是 sandbox。

---

## Auto-Approve 流程 `tui.tsx`

### 狀態

```typescript
const [autoApprove, setAutoApprove] = createSignal(false)
```

### 修改後的 ask callback

```
ask(req)
    │
    ├── shouldAutoApprove(req, rules)? ──→ YES ──→ resolve()
    │       (safe permissions + user's "always allow" rules)
    │
    └── autoApprove() === true?
            │
            ├── req.permission === "bash"
            │       └── isDangerousCommand(req.patterns)?
            │               ├── YES → showApprovalDialog()
            │               └── NO  → resolve()
            │
            └── req.permission !== "bash"
                    └── resolve()  // write/edit auto-approved
```

### Palette UI

在 `actionPaletteItems` 的 DISPLAY 區塊新増：

```typescript
{
  label: "Auto-approve",
  hint: autoApprove() ? "ON" : "OFF",
  onSelect: () => { setAutoApprove(c => !c); setShowPalette(false) },
}
```

---

## 安全性分析

### 開啟 auto-approve 後

| 場景 | 結果 |
|------|------|
| LLM 執行 `read file.ts` | ✅ 自動放行（safe permission） |
| LLM 執行 `write file.ts` 寫入內容 | ✅ 自動放行（非 destructive） |
| LLM 執行 `edit file.ts` 取代字串 | ✅ 自動放行（非 destructive） |
| LLM 執行 `bash echo hello` | ✅ 自動放行（非 destructive） |
| LLM 執行 `bash rm -rf /tmp/cache` | ❌ 跳出審批對話框 |
| LLM 執行 `bash truncate -s 0 data.db` | ❌ 跳出審批對話框 |
| LLM 執行 `bash VAR=val rm file` | ⚠️ 可能漏擋（需要 normalize） |

### 繞過風險

以下方法可能繞過 destructive pattern 檢查：

1. **透過變數**：`CMD=rm; $CMD file` → pattern 只看開頭 `CMD=rm`，不是 `rm`
2. **透過 `eval`**：`eval "rm file"` → pattern 只看 `eval`，不是 `rm`
3. **透過 base64**：`echo cm0gZmlsZQ== | base64 -d | sh` → 完全無法靜態偵測
4. **透過 find**：`find . -name "*.log" -delete` → 使用 `-delete` 而非 `rm`

這些繞過方式需要更複雜的靜態分析（語法樹、變數追蹤）才能防禦，超出本設計範圍。如果使用者有更高安全需求，建議不要開啟 auto-approve，或搭配 sandbox 執行環境。

---

## 實作順序

```
Step 1: permission-rules.ts 新增 isDangerousCommand()
Step 2: tui.tsx 新增 autoApprove signal + 修改 ask callback
Step 3: palette 加入 toggle
Step 4: (可選) commands.ts 加入 /auto 指令
Step 5: 寫測試 permission-rules.test.ts
```

---

## 未納入設計的項目

- **不** 做 session-level persistence（auto-approve 狀態不存檔，每次重開需要手動開啟）
- **不** 做 protected paths 設定（如 `~/Documents` 禁止寫入）
- **不** 做 sandbox / container 隔離
- **不** 做 audit log
- **不** 做 per-tool 細粒度控制（全部或全部不）
