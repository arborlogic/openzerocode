# OpenZeroCode

Coding agent framework extracted from opencode, designed to work with zero-api as backend.

## Architecture

```
┌─ Client (CLI / IDE Plugin) ───────────┐
│  openzerocode                          │
│  - Core loop (runLoop)                 │
│  - Tool registry & execution           │
│  - Permission system                   │
│  - Provider SDK abstraction            │
└────────┬───────────────────────────────┘
         │ HTTP
         ▼
┌─ zero-api ─────────────────────────────┐
│  - Auth (API key)                      │
│  - Chat proxy                          │
│  - Session CRUD                        │
│  - Typed memory (FTS + RAG)            │
│  - Correction loop                     │
│  - Context builder                     │
└────────────────────────────────────────┘
```

## Status

Scaffold. Nothing implemented yet.
