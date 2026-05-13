# OpenZeroCode — Response Redesign Notes

本文件保留 `opencode` 對照研究、目前已完成的 response redesign 項目，以及剩餘的改造方向。

---

## Why This Work Exists

最初的問題不是資料缺失，而是呈現模型過於扁平：

- 所有內容被壓成 `DisplayBlock[]`
- 大部分 block 共用同一套視覺結構
- assistant response 缺少 footer / summary / change context
- user prompt、assistant parts、tool outputs 之間缺少視覺綁定

`opencode` 提供的主要參考點是：

- turn-oriented transcript
- part-specific renderer
- assistant footer/meta
- working/thinking 中間態
- tool-specific high-signal cards
- response-scoped diff summary

## Current Reference Findings

對照來源：

- `submodules/opencode/packages/ui/src/components/session-turn.tsx`
- `submodules/opencode/packages/ui/src/components/message-part.tsx`

最值得沿用的設計原則：

- 用 turn，而不是 flat block list
- 用 part-specific UI，而不是 generic block renderer
- 把 assistant metadata 放回 response 結尾
- 讓 tool 結果有更高的視覺權重
- 把 code changes 綁回該輪 response

## Completed

### Phase 1 — Turn Skeleton

已完成：

- response 從 flat block 流改成 turn-oriented transcript group
- user prompt 成為 turn 起點
- assistant / tool / streaming parts 併入同一輪 render

### Phase 2 — Basic Block Cleanup

已完成：

- 純 `user` / `assistant` / `system` 文字不再顯示冗餘 header
- reasoning / tool / error block 已具備基本 collapse 行為

### Phase 3 — Basic Assistant Footer

已完成：

- assistant response 已有第一版 footer
- 目前先顯示 session-level `provider/model`
- 有 copy hint，但還沒有獨立 copy button

## Remaining

### P1 — Coding-Agent Clarity

- Rich tool-specific cards
- Response-scoped diff summary
- Per-message provider/model metadata

### P2 — Interaction Polish

- Working / thinking 中間態 polish
- Paced streaming
- Copy affordance button

## Deferred

- 完整模仿 opencode 的 rich diff viewer
- 過度複雜的 hover / tooltip interaction
- 沒有明確使用價值前，不增加更重的 response chrome

## Risks And Tradeoffs

### Risk 1 — 現有資料模型沒有完整 per-message meta

影響：

- footer 第一版只能先顯示 session-level provider/model

### Risk 2 — TUI 過度模仿 Web UI 會變得太吵

影響：

- 終端視覺密度容易失控

### Risk 3 — response 改造會直接影響 summary / memory quality

影響：

- future `SESSION_SUMMARY.md` 的品質會依賴 response 結構是否足夠清楚

## Next Recommended Work

### P0 — Stability / Readability

- Tool output truncation

### P1 — Coding-Agent Clarity

- Response-scoped diff summary
- Rich tool-specific cards
- Per-message provider/model metadata

### P2 — Interaction Polish

- Smart auto-follow
- Working / thinking polish
- Paced streaming
