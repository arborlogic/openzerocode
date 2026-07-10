# GEASS Vision Integration for OpenZeroCode

Status: initial implementation landed  
Scope: `openzerocode` agent runtime and tool surface  
Related repo: `../geass-desktop`

## Goal

OpenZeroCode should be able to operate a real browser through GEASS Desktop and, when DOM/text observation is not enough, request a visual observation of the current browser page.

The split of responsibility is:

- **OpenZeroCode**: agent-facing tools, permission prompts, result formatting, prompt guidance, and model/provider compatibility.
- **GEASS Desktop**: browser hosting, DOM extraction, screenshots, visual element localization, and page action execution.

This keeps OpenZeroCode usable without GEASS, while letting GEASS act as an optional browser/vision extension.

## Current implemented baseline

OpenZeroCode already has a GEASS client at `src/browser/geass-client.ts` and built-in browser tools registered in `src/tool/registry.ts`:

- `browser_navigate`
- `browser_read`
- `browser_click`
- `browser_type`
- `browser_select`
- `browser_scroll`
- `browser_screenshot`
- `browser_observe_visual`

The screenshot tool calls GEASS `POST /screenshot` and returns metadata plus a Markdown data URL:

```md
![screenshot](data:image/png;base64,...)
```

GEASS Desktop session window mode is supported through an environment variable. By default, OpenZeroCode talks to the main GEASS window through the existing root endpoints (`/navigate`, `/page`, etc.). To bind an OpenZeroCode process to a dedicated GEASS agent window on the same API port, start it with either:

```sh
GEASS_SESSION_ID=agent-a openzerocode
# or
OPENZEROCODE_GEASS_SESSION_ID=agent-a openzerocode
```

When set to a non-`default` value, the built-in browser tools route requests to `/sessions/:sessionId/...`. GEASS lazily creates the corresponding agent window and shows the binding/session id in that window. Cookies and browser session state are still shared by GEASS Desktop.

`browser_observe_visual` calls GEASS `POST /observe-visual` and can now optionally call a local VLM before returning the result. This is useful when the current chat model cannot consume image data URLs directly or when large base64 tool output would be truncated.

Local VLM defaults:

- Endpoint: `http://10.66.66.5:8080`
- Model: `llava`
- Override endpoint with `OPENZEROCODE_VLM_URL` or per-call `vlmEndpoint`.
- Override model with `OPENZEROCODE_VLM_MODEL` or per-call `vlmModel`.
- The client first tries OpenAI-compatible `POST /v1/chat/completions` with an `image_url` message part, then falls back to llama.cpp-style `POST /completion` with `image_data`.

This is still not a full visual-targeting workflow because OpenZeroCode does not yet reconcile visual coordinates with browser actions. The agent should map visual findings back to labels/selectors from structured page context whenever possible.

## Target user experience

For normal browser work, the agent should prefer structured DOM state:

1. `browser_navigate` to open the page.
2. `browser_read` to get URL/title/headings/interactive elements/text.
3. Action tools (`browser_click`, `browser_type`, etc.) using labels or selector hints.

For visually ambiguous tasks, the agent should escalate:

1. `browser_observe_visual` captures the current viewport plus structured page context, or `browser_screenshot` captures only the current viewport.
2. If the selected chat model cannot directly inspect images, call `browser_observe_visual` with `analyzeWithLocalVlm: true` so the configured local VLM returns a textual visual description.
3. A vision-capable model or the local VLM analysis identifies visual targets or layout state.
4. The agent maps the visual finding back to DOM labels/selectors where possible.
5. If no selector can be inferred, GEASS Desktop should provide visual targeting support in its own API layer.

Examples that should trigger visual observation:

- Canvas-heavy apps, maps, diagrams, whiteboards, games.
- CAPTCHA-like visual checks where the user explicitly instructs local observation and policy allows continuing.
- UI bugs where layout, overlap, color, disabled state, or viewport position matters.
- Icon-only controls without accessible labels.
- Screens where `browser_read` has insufficient or misleading DOM text.

## Proposed OpenZeroCode tool contract

Keep the existing tools stable. Additive enhancements should avoid breaking current GEASS Desktop builds.

### `browser_screenshot` v1 compatibility

Current response:

```ts
{
  base64: string
}
```

Current OpenZeroCode rendering:

```md
![screenshot](data:image/png;base64,<base64>)
```

This should remain supported.

### `browser_observe_visual`

The additive `browser_observe_visual` tool calls GEASS `POST /observe-visual` and returns structured page context and viewport metadata. By default it also returns a screenshot attachment for provider-native vision. If `analyzeWithLocalVlm` is true, it sends the screenshot to the configured local VLM and returns the VLM's text analysis first; if VLM analysis fails, it falls back to the screenshot attachment. `analyze_image` prefers native provider vision when `modelSupportsVision(chatModel)` is true, and only uses the local VLM as a fallback (or when endpoint/model overrides are provided).

Target contract:

```ts
type BrowserObserveVisualArgs = {
  prompt?: string
  analyzeWithLocalVlm?: boolean
  vlmEndpoint?: string
  vlmModel?: string
}

type BrowserObserveVisualResult = {
  image: {
    mediaType: 'image/png' | 'image/jpeg'
    base64: string
    width: number
    height: number
  }
  page: {
    url: string
    title: string
    viewport: { width: number; height: number; deviceScaleFactor: number }
  }
  overlays?: Array<{
    id: string
    role: string
    label?: string
    selectorHint?: string
    rect: { x: number; y: number; width: number; height: number }
  }>
}
```

Rationale:

- Plain screenshots help models describe a page.
- DOM overlays let the model refer to stable element ids instead of raw coordinates.
- Viewport metadata prevents CSS-pixel/device-pixel confusion.

## Provider/model requirements

OpenZeroCode should treat vision as a capability, not an assumption.

Recommended checks before adding a dedicated visual observation tool:

- Provider can encode image inputs as first-class message parts.
- Provider/model metadata exposes a vision capability or model allowlist.
- Tool result rendering does not silently strip large base64 payloads.
- Transcript persistence can tolerate image payload size or stores compact references.
- If image blocks are not available, a local VLM endpoint can convert the screenshot into compact text.

Fallback behavior when no VLM is available:

- Keep `browser_screenshot` available for human-visible transcript context.
- Prefer `browser_read` + DOM tools.
- Explain that visual reasoning requires a vision-capable model or configured local VLM if the task cannot be solved structurally.

## Local VLM configuration

`browser_observe_visual` accepts per-call VLM options and also reads environment variables:

```json
{
  "analyzeWithLocalVlm": true,
  "prompt": "Describe visible dialogs and identify the safest click target.",
  "vlmEndpoint": "http://10.66.66.5:8080",
  "vlmModel": "llava"
}
```

Environment variables:

- `OPENZEROCODE_VLM_URL` or `GEASS_VLM_URL`: local VLM server URL.
- `OPENZEROCODE_VLM_MODEL` or `GEASS_VLM_MODEL`: model name for OpenAI-compatible servers.
- `OPENZEROCODE_VLM_TIMEOUT_MS`: request timeout, default `60000`.

Supported request shapes:

1. OpenAI-compatible `POST /v1/chat/completions` with text plus `image_url` content.
2. llama.cpp-style `POST /completion` with `image_data` fallback.

## Prompt guidance

System/tool guidance should make this order explicit:

1. Use `web_fetch` for static web pages and documentation that do not need JS.
2. Use GEASS browser tools for JS-rendered sites or interactive browser work.
3. Use `browser_read` before screenshot when text/DOM can answer the question.
4. Use `browser_screenshot` or `browser_observe_visual` only when visual layout matters.
5. Use `browser_observe_visual` with `analyzeWithLocalVlm: true` when the current chat model cannot inspect image data directly.
6. Do not rely on pixel coordinates if a label, role, or selector hint is available.

## Permission and privacy

Browser vision can expose sensitive user data. OpenZeroCode should keep permission checks separate and visible:

- `browser_read`: DOM/text observation permission.
- `browser_screenshot`: visual capture permission.
- Future visual-targeted actions: action permission with target metadata.

Do not auto-upload screenshots outside the selected model provider path. Do not persist screenshots longer than required unless transcript storage explicitly supports and discloses it.

## Integration checklist

OpenZeroCode side:

- [x] GEASS HTTP client exists: `src/browser/geass-client.ts`.
- [x] Route browser tools to GEASS session windows when `OPENZEROCODE_GEASS_SESSION_ID` or `GEASS_SESSION_ID` is set.
- [x] Browser action/read/screenshot tools exist under `src/tool/`.
- [x] Tools are registered in `src/tool/registry.ts`.
- [x] Add `browser_observe_visual` tool for combined screenshot + DOM context.
- [x] Add optional local VLM analysis for `browser_observe_visual`.
- [x] Add provider-level image message support if missing.
- [x] Add model capability detection for vision (`modelSupportsVision` + tool Context.model).
- [x] Prefer native provider vision for `analyze_image` when the chat model supports vision; local VLM is fallback only.
- [ ] Add tests around screenshot result formatting and GEASS offline fallback.
- [ ] Add prompt guidance for when to use DOM vs screenshot.

GEASS Desktop side:

- [x] Return screenshot dimensions and viewport metadata.
- [x] Add `POST /observe-visual` for screenshot + structured page context.
- [ ] Optionally return DOM overlay rectangles alongside screenshot.
- [ ] Support visual-targeted action mapping from overlay id or coordinates to DOM action.

## Non-goals for this phase

- Do not make OpenZeroCode depend on GEASS Desktop at startup.
- Do not replace DOM observation with screenshots for normal pages.
- Do not build a separate browser automation stack inside OpenZeroCode.
- Do not store long-term visual memory in `AGENTS.md`, `CONTEXT.md`, or `SESSION_SUMMARY.md`.
