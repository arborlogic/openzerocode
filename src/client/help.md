## Commands

  /help                  Show this help
  /clear                Clear conversation history
  /new                  Start a fresh session
  /provider [id|list]    Show or switch provider
  /codex-login           Authorize OpenAI Codex
  /xai-login             Authorize xAI Grok (SuperGrok / X Premium+)
  /mode                  Cycle build / plan / compose mode
  /model [name|list]     Show or switch model
  /sessions  [/s]        Open session switcher
  /tools                 Toggle completed tool details
  /thinking              Toggle thinking blocks
  /auto                  Toggle auto-approve mode
  /autopilot [standard|proactive|execute|off]
                         Continue routine prompts, advance a plan, or execute an approved TODO list
  /commit                Generate a commit message from current changes
  /exit  [/quit]         Exit the app
  exit  quit             Also work without the slash

## Keyboard Shortcuts

  Enter                  Submit message
  Shift/Ctrl/Alt+Enter   Insert newline
  Ctrl+P  or  F2         Open command palette
  Esc                    Cancel / close palette
  ↑ / ↓                  Browse input history
  PgUp / PgDn            Scroll response
  Home / End             Jump to top / bottom of response
  Mouse wheel            Scroll response area

## Command Palette  (Ctrl+P / F2)

  INPUT
    Focus input          Return focus to the composer
    Auto-approve         Toggle automatic tool approval
    Autopilot            Choose standard, proactive, or continuous TODO execution

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

  MODEL
    Switch mode          Cycle build → plan → compose
    Switch provider      Pick AI provider
    Switch model         Pick model for current provider

## Message Actions  (click a user message)

  Revert   Remove this message and everything after it,
           then place the text back in the composer for re-editing
  Copy     Copy message text to clipboard
  Fork     Create a new session branching from this point
