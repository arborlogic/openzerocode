# Changelog

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

