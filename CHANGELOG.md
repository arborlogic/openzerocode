# Changelog

## 0.6.0 - 2026-07-10

- Added `xai-oauth` provider with SuperGrok / X Premium+ device-code login (`/xai-login`), token refresh, and Responses API transport for Grok models.
- Added multimodal image support across providers, including image budgeting and message part conversion tests.
- Added `analyze_image` and `apply_patch` tools for visual file analysis and patch-style edits.
- Added two-stage Learn mode with explicit global memory updates and project `DEVELOPMENT.md` extraction.
- Added workspace memory loading and documentation for the memory architecture.
- Added queued prompt handling during session compaction so input is preserved while compacting.
- Improved markdown diff parsing and rendering, including contained diff row backgrounds and richer parser coverage.
- Improved sidebar width handling and terminal layout constants.
- Improved Zero API and Ollama provider handling with expanded tests.
- Fixed GEASS/browser visual observation behavior and screenshot path handling.
- Refined tool output/path handling and registry coverage.

## 0.5.0 - 2026-06-20

- Added Ollama native API provider support.
- Added MCP client with Chrome DevTools MCP as a selectable tool group.
- Added selectable tool groups palette (renamed from Experiments).
- Added GEASS session routing — browser tools now open in per-session agent windows.
- Rendered markdown tables in TUI responses.
- Improved sidebar git file grouping.
- Refined system prompt with environment section and plan-mode tool gating.
- Reduced idle polling frequency and added git snapshot dependency tracking.
- Fixed MCP Content-Length framing and deduplicated concurrent loads.
- Fixed MCP config handling and chrome-devtools-mcp binary path resolution.
- Fixed TUI tools palette staying open on toggle.
- Fixed markdown diff rendering.
- Upgraded tsx to 4.22.4 to resolve esbuild path traversal (GHSA-g7r4-m6w7-qqqr).

## 0.4.5 - 2026-06-14

- Added peer communication support, including the `call_peer` tool and design documentation.
- Added GEASS visual browser observation enhancements with local VLM prompt/model options.
- Added queued input message handling for the TUI.
- Optimized parallel tool execution and capped large `bash`/`grep` tool outputs.
- Refactored TUI helpers into focused client modules with expanded unit coverage.
- Updated release documentation and changelog validation flow.

## 0.4.3 - 2026-06-06

- Added autoloop mode and a configurable max steps palette setting.
- Improved step-limit notifications and streaming markdown diff rendering.
- Refactored TUI display components and extracted pure client utilities.
- Fixed sidebar scrollbox masking and OpenCode Zen model list refresh behavior.
- Added release automation script.

