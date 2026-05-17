/**
 * Help text shown in the /help palette popup.
 * Edit this file to update the help content.
 */
export const HELP_CONTENT = `\
Commands

  /help                  Show this help
  /clear                Clear conversation history
  /new                  Start a fresh session
  /provider [id|list]    Show or switch provider
  /codex-login           Authorize OpenAI Codex
  /mode                  Toggle build / plan mode
  /model [name|list]     Show or switch model
  /sessions  [/s]        Open session switcher
  /tools                 Toggle completed tool details
  /thinking              Toggle thinking blocks
  /auto                  Toggle auto-approve mode
  /usage                 Open token usage dashboard
  /commit                Generate a commit message from current changes
  /exit  [/quit]         Exit the app
  exit  quit             Also work without the slash

Keyboard Shortcuts

  Enter                  Submit message
  Shift/Ctrl/Alt+Enter   Insert newline
  Ctrl+P  or  F2         Open command palette
  Esc                    Cancel / close palette
  ↑ / ↓                  Browse input history
  PgUp / PgDn            Scroll response
  Home / End             Jump to top / bottom of response
  Mouse wheel            Scroll response area

Command Palette  (Ctrl+P / F2)

  INPUT
    Focus input          Return focus to the composer
    Auto-approve         Toggle automatic tool approval

  DISPLAY
    Display settings     Toggle tools, thinking, layout
    Reload config        Re-read API keys and config files

  SESSION
    New session          Start a fresh conversation
    Switch session       Pick an existing session
    Change directory     Switch workspace and return to welcome
    Rename session       Set a custom title
    Compact session      Summarise and compress history
    Timeline             Browse messages → Revert / Copy / Fork

  USAGE
    Usage dashboard      Token usage by session / provider / model

  MODEL
    Switch mode          Toggle build ↔ plan
    Switch provider      Pick AI provider
    Switch model         Pick model for current provider

Usage Dashboard  (/usage or palette → USAGE)

  Views            Sessions (default) · Global · Daily · Hourly
  Keyboard         Tab / ← → cycle tabs  •  1-4 jump to tab  •  Esc close
  Sessions view    Per-session breakdown, last 5 requests with in/out tokens
  Global view      All-time totals aggregated by provider / key / model
  Daily view       Last 14 days aggregated
  Hourly view      Last 48 hours aggregated

Message Actions  (click a user message)

  Revert   Remove this message and everything after it,
           then place the text back in the composer for re-editing
  Copy     Copy message text to clipboard
  Fork     Create a new session branching from this point
`
