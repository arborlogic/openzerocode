# Session Summary

- Added first-class `openai` provider support using the existing OpenAI-compatible chat completions layer.
- Updated OpenAI defaults to `gpt-5.4`.
- Added `openai-codex` provider support that reads Codex CLI auth (`~/.codex/auth.json`) and opencode OAuth auth (`XDG_DATA_HOME/opencode/auth.json`) and sends requests to the Codex responses endpoint.
- Added `/codex-login` device authorization flow and fixed Codex requests to send system prompts via required `instructions`.
- Restored provider selection flow to provider -> keys management -> model, with env/OAuth status shown on the keys page.
- Provider registry now supports env key detection via `envKeys`; OpenAI uses `OPENAI_API_KEY`, OpenRouter uses `OPENROUTER_API_KEY`, and OpenCode Zen uses `OPENCODE_API` / `OPENCODE_API_KEY`.
- Provider palette now opens key setup first for auth-required providers when neither stored keys nor env keys are present.
- Verified targeted provider tests pass; full `npm run typecheck` is currently blocked by existing `bun:test` type resolution in `src/client/commands.test.ts`.
