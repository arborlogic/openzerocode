# [S1] Problem

MiMoCode ships with 16 builtin skills and 15 compose skills. OpenZeroCode has 9 compose skills but no builtin skills and is missing 6 compose skills. The user wants to port 17 skills (11 builtin + 6 compose) from MiMoCode to OpenZeroCode, adapting them to reference OpenZeroCode's own features and paths.

## [S2] Scope

**Skills to port (17 total):**

### Compose skills (6) → `skills/compose/<name>/SKILL.md`

| Skill | Companion files |
|-------|----------------|
| compose:ask | none |
| compose:parallel | none |
| compose:feedback | none |
| compose:report | none |
| compose:subagent | implementer-prompt.md, spec-reviewer-prompt.md, code-quality-reviewer-prompt.md |
| compose:worktree | none |

### Builtin skills (11) → `skills/<name>/SKILL.md`

| Skill | Companion files |
|-------|----------------|
| openzerocode (from mimocode) | reference/ subdirectory (guide.md, config.md, commands.md, permissions.md, workflows.md) |
| docx-official | scripts/, references/ (create.md, edit.md, read.md) |
| pdf-official | scripts/, references/ (extract.md, transform.md, compose.md, interactive.md) |
| pptx-official | scripts/, references/ (create.md, edit.md, read.md) |
| xlsx-official | scripts/, references/ (create.md, edit.md, read.md, analyze.md) |
| design-blueprint | assets/, references/ (six-layer-model.md, embody-modes.md, design-directions.md, anti-slop.md, decision-trace.md, nine-section-protocol.md) |
| frontend-design | none |
| skill-creator | scripts/ (validate_skill.py), references/ (frontmatter.md, patterns.md, testing.md) |
| evolve | reference/ (hook-api.md, tool-api.md, skill-api.md, tui-api.md) |
| loop | none |
| modern-python-toolchain | none |

**Excluded (user confirmed):** arxiv, research-paper-writing, html-to-video-pipeline, deep-research, super-research

## [S3] Directory structure

```
skills/
├── compose/
│   ├── ask/SKILL.md
│   ├── parallel/SKILL.md
│   ├── feedback/SKILL.md
│   ├── report/SKILL.md
│   ├── subagent/
│   │   ├── SKILL.md
│   │   ├── implementer-prompt.md
│   │   ├── spec-reviewer-prompt.md
│   │   └── code-quality-reviewer-prompt.md
│   └── worktree/SKILL.md
├── openzerocode/
│   ├── SKILL.md
│   └── reference/ (guide.md, config.md, commands.md, permissions.md, workflows.md)
├── docx-official/
│   ├── SKILL.md
│   ├── scripts/
│   └── references/
├── pdf-official/
│   ├── SKILL.md
│   ├── scripts/
│   └── references/
├── pptx-official/
│   ├── SKILL.md
│   ├── scripts/
│   └── references/
├── xlsx-official/
│   ├── SKILL.md
│   ├── scripts/
│   └── references/
├── design-blueprint/
│   ├── SKILL.md
│   ├── assets/
│   └── references/
├── frontend-design/
│   └── SKILL.md
├── skill-creator/
│   ├── SKILL.md
│   ├── scripts/
│   └── references/
├── evolve/
│   ├── SKILL.md
│   └── reference/
├── loop/
│   └── SKILL.md
└── modern-python-toolchain/
    └── SKILL.md
```

## [S4] Adaptations required

### openzerocode skill (from mimocode)

The mimocode skill is a self-documenting reference for MiMoCode features. It needs full rewrite to reference OpenZeroCode:

- Name: `mimocode` → `openzerocode`
- Binary: `mimo` → `openzerocode`
- Config paths: `~/.config/mimocode/` → `~/.config/openzerocode/`
- Data paths: `~/.local/share/mimocode/` → `~/.local/share/openzerocode/`
- Feature map: rewrite to match OpenZeroCode's actual features (TUI, build/plan/compose modes, provider switching, GEASS browser, 18 built-in tools, learn mode, etc.)
- Compose skills list: update to match the 15 compose skills being ported
- Commands: update slash commands to match OpenZeroCode's actual commands
- Config schema: reference OpenZeroCode's config structure
- Remove MiMoCode-specific features: voice, dream, distill, cron/loop (unless OpenZeroCode has them), goal, experimental.maxMode

### evolve skill

- `.mimocode/` → `.openzerocode/` for all extension paths
- Tool/hook/skill/workflow/TUI paths updated
- Plugin API references updated to OpenZeroCode's plugin system

### Compose skills (ask, parallel, feedback, report, subagent, worktree)

These are largely universal — they reference `compose:ask`, `actor` tool, `task` tool, `compose:review`, `compose:merge` which all exist or will exist in OpenZeroCode. Minimal adaptation needed:
- Remove references to MiMoCode-specific features (visual companion, memory preferences)
- Keep the core workflow logic intact

### docx/pdf/pptx/xlsx-official skills

These are universal document-handling skills. The SKILL.md content is mostly portable as-is. Scripts are Python-based and use standard libraries. Adaptations:
- Ensure script paths in SKILL.md reference the correct relative locations
- Copy all companion files (scripts/, references/)

### design-blueprint, frontend-design, skill-creator, loop, modern-python-toolchain

Mostly universal. Minimal adaptation:
- design-blueprint: copy references/ and assets/
- skill-creator: copy scripts/validate_skill.py and references/
- loop: ensure `/loop` command reference matches OpenZeroCode
- modern-python-toolchain: no changes needed

## [S5] Loading mechanism

OpenZeroCode has two skill loading paths:

1. **Compose mode** (`skills/compose/<name>/SKILL.md`): loaded by `system-prompt.ts` into the compose mode system prompt. These are the compose skills.

2. **CLI/GEASS mode** (`skills/<name>/SKILL.md`): loaded by `skill-loader.ts` when a URL matches the skill's frontmatter `domains` or `url_patterns`. The builtin skills go here.

**Note:** Builtin skills in `skills/<name>/` are only auto-loaded in CLI/GEASS mode via URL matching. In the TUI, they won't auto-trigger — the user would need to reference them explicitly or they'd need to be loaded via a different mechanism. This is acceptable for the initial port; a future enhancement could add TUI skill discovery.

## [S6] Implementation order

1. Copy compose skills (ask, parallel, feedback, report, worktree) — minimal adaptation
2. Copy subagent skill with companion files — minimal adaptation
3. Copy builtin skills without heavy adaptation (loop, modern-python-toolchain, frontend-design)
4. Copy docx/pdf/pptx/xlsx with scripts and references — verify scripts work
5. Copy design-blueprint with references and assets
6. Copy skill-creator with scripts and references
7. Copy evolve with reference files — adapt paths
8. Adapt openzerocode skill from mimocode — rewrite for OpenZeroCode features
9. Update system-prompt.ts to list new compose skills in the COMPOSE_MODE_REMINDER
10. Verify all skills load correctly

## [S7] Verification

- Run `npm run typecheck` to ensure no TypeScript errors
- Check that compose skills are loaded by `loadComposeSkills()` in system-prompt.ts
- Verify skill-loader.ts can discover builtin skills in `skills/<name>/`
- Spot-check a few skills for correct frontmatter and body content
