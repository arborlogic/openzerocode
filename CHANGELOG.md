# Changelog

## 0.8.1 - 2026-07-20

### Fixed

- Optimize Codex streaming and fix markdown rendering issues

## 0.8.0 - 2026-07-20

### Added

- Added **Execute Plan Autopilot** (`/autopilot execute`) to continuously implement an approved, ordered TODO list, then run integrated verification and one final review.
- Added the latest OpenAI Codex model IDs: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, and `gpt-5.5`.
- Added regression coverage for streamed markdown blocks, transcript rendering stability, response-entry transitions, and Execute Plan Autopilot behavior.

### Changed

- Upgraded OpenTUI core and Solid rendering dependencies to 0.4.5.
- Improved streaming markdown parsing and TUI rendering so completed responses retain inline and block-level Markdown styles.
- Refined the Compose execute workflow to complete approved tasks continuously, reserving broad verification and review until all tasks are complete.
- Updated the terminal theme, including richer Markdown syntax highlighting and improved color contrast.

### Fixed

- Fixed streamed Markdown block boundaries and transcript updates that could cause flicker, duplicated content, or lost Markdown styling.
- Stabilized TUI render updates while responses stream.

## 0.7.0 - 2026-07-16

### Added

- Added bundled, discoverable skills and the `/skills`, `/skill <name>`, and `/review [target]` commands, including built-in commit and review helpers.
- Added Compose mode and a bundled spec-driven workflow covering brainstorming, planning, TDD, execution, verification, review, and related development tasks.
- Added Autopilot modes: **standard** can continue safe, routine work and **proactive** can advance explicitly established plans with bounded, rate-limit-aware retries.
- Added tab/Shift+Tab cycling for slash-command arguments, a skills reference dialog, built-in-skill filtering, and sidebar usability improvements.
- Added a command-palette preference to force image analysis through a local VLM without changing the active chat model.
- Added bounded multi-peer collaboration support and improved peer context handling.
- Added support for text-only response output items from the Zero API.

### Changed

- Bundled skills are now shipped beside platform binaries and installed into an installer-managed `bundled-skills` directory; upgrades replace that directory while preserving user-managed sibling `skills`.
- Dev/npm installations now include the files required to deploy bundled skills after installation.
- Plan mode is read-only: it permits inspection tools only and blocks workspace, shell, and browser mutations.
- Refined system prompts, context compression defaults, token/model metadata handling, and proactive continuation safeguards.
- The TUI now uses a fixed vertical layout with its sidebar initially collapsed, replacing the terminal-shape-dependent layout preference.

### Fixed

- Added release checks that pack a native platform package and verify bundled skills are included in its npm tarball.
- Added runtime-state coverage that prevents Autopilot continuation checks while work, compaction, approval, queue draining, or rate-limit retry is pending.
- Fixed bundled-skill upgrades leaving removed skills behind.
- Fixed sidebar scroll-range recalculation after content changes.
- Fixed native-vision test coverage to use the currently supported Codex vision model metadata.

### Breaking changes

- Replaced Learn mode with Compose mode. Use `/mode compose`; the previous memory-learning workflow is no longer available through `/mode learn`.
- Replaced `/autoloop` with `/autopilot [standard|proactive|off]`.
- Removed hardcoded metadata for generic `gpt-5.4`, `gpt-5.5`, and their mini/nano variants. Provider-supplied metadata is now used for those models; explicit Codex model metadata remains available.

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

