# MiMoCode Skills Port Implementation Plan

> **For agentic workers:** Use compose:execute to implement this plan task-by-task.

**Goal:** Port 17 skills from MiMoCode to OpenZeroCode — 6 compose skills and 11 builtin skills with all companion files.

**Architecture:** Copy skills from `~/.local/share/mimocode/` to OpenZeroCode's `skills/` directory, adapting paths and content for OpenZeroCode. Two skills (openzerocode, evolve) require significant rewriting; the rest are mostly mechanical copies.

**Tech Stack:** Markdown skill files, Python scripts (docx/pdf/pptx/xlsx), TypeScript (evolve tool/hook APIs)

## Global Constraints

- All compose skills go in `skills/compose/<name>/SKILL.md`
- All builtin skills go in `skills/<name>/SKILL.md`
- Companion files (scripts/, references/, assets/) go alongside SKILL.md
- MiMoCode paths (`.mimocode/`) must be adapted to OpenZeroCode paths (`.openzerocode/`)
- YAML frontmatter must include `name` and `description` fields
- No XML angle brackets in frontmatter

---

### Task 1: Copy compose skills (ask, parallel, feedback, report, worktree)

**Covers:** [S2]

**Files:**
- Create: `skills/compose/ask/SKILL.md`
- Create: `skills/compose/parallel/SKILL.md`
- Create: `skills/compose/feedback/SKILL.md`
- Create: `skills/compose/report/SKILL.md`
- Create: `skills/compose/worktree/SKILL.md`

**Source:** `~/.local/share/mimocode/compose/0.1.5/skills/<name>/SKILL.md`

- [ ] **Step 1: Copy compose:ask**

```bash
mkdir -p skills/compose/ask
cp ~/.local/share/mimocode/compose/0.1.5/skills/ask/SKILL.md skills/compose/ask/SKILL.md
```

Verify frontmatter has `name: compose:ask` and `description`. Remove `hidden: true` from frontmatter if present (openzerocode doesn't use it).

- [ ] **Step 2: Copy compose:parallel**

```bash
mkdir -p skills/compose/parallel
cp ~/.local/share/mimocode/compose/0.1.5/skills/parallel/SKILL.md skills/compose/parallel/SKILL.md
```

Remove `hidden: true` from frontmatter.

- [ ] **Step 3: Copy compose:feedback**

```bash
mkdir -p skills/compose/feedback
cp ~/.local/share/mimocode/compose/0.1.5/skills/feedback/SKILL.md skills/compose/feedback/SKILL.md
```

Remove `hidden: true` from frontmatter.

- [ ] **Step 4: Copy compose:report**

```bash
mkdir -p skills/compose/report
cp ~/.local/share/mimocode/compose/0.1.5/skills/report/SKILL.md skills/compose/report/SKILL.md
```

Remove `hidden: true` from frontmatter.

- [ ] **Step 5: Copy compose:worktree**

```bash
mkdir -p skills/compose/worktree
cp ~/.local/share/mimocode/compose/0.1.5/skills/worktree/SKILL.md skills/compose/worktree/SKILL.md
```

Remove `hidden: true` from frontmatter.

- [ ] **Step 6: Commit**

```bash
git add skills/compose/ask skills/compose/parallel skills/compose/feedback skills/compose/report skills/compose/worktree
git commit -m "feat: port 5 compose skills from MiMoCode (ask, parallel, feedback, report, worktree)"
```

---

### Task 2: Copy compose:subagent with companion files

**Covers:** [S2]

**Files:**
- Create: `skills/compose/subagent/SKILL.md`
- Create: `skills/compose/subagent/implementer-prompt.md`
- Create: `skills/compose/subagent/spec-reviewer-prompt.md`
- Create: `skills/compose/subagent/code-quality-reviewer-prompt.md`

**Source:** `~/.local/share/mimocode/compose/0.1.5/skills/subagent/`

- [ ] **Step 1: Copy subagent directory**

```bash
mkdir -p skills/compose/subagent
cp ~/.local/share/mimocode/compose/0.1.5/skills/subagent/SKILL.md skills/compose/subagent/
cp ~/.local/share/mimocode/compose/0.1.5/skills/subagent/implementer-prompt.md skills/compose/subagent/
cp ~/.local/share/mimocode/compose/0.1.5/skills/subagent/spec-reviewer-prompt.md skills/compose/subagent/
cp ~/.local/share/mimocode/compose/0.1.5/skills/subagent/code-quality-reviewer-prompt.md skills/compose/subagent/
```

Remove `hidden: true` from SKILL.md frontmatter.

- [ ] **Step 2: Commit**

```bash
git add skills/compose/subagent/
git commit -m "feat: port compose:subagent skill with prompt templates from MiMoCode"
```

---

### Task 3: Copy builtin skills without heavy adaptation

**Covers:** [S2]

**Files:**
- Create: `skills/loop/SKILL.md`
- Create: `skills/modern-python-toolchain/SKILL.md`
- Create: `skills/frontend-design/SKILL.md`

**Source:** `~/.local/share/mimocode/builtin_skills/0.1.5/skills/<name>/SKILL.md`

- [ ] **Step 1: Copy loop**

```bash
mkdir -p skills/loop
cp ~/.local/share/mimocode/builtin_skills/0.1.5/skills/loop/SKILL.md skills/loop/
```

- [ ] **Step 2: Copy modern-python-toolchain**

```bash
mkdir -p skills/modern-python-toolchain
cp ~/.local/share/mimocode/builtin_skills/0.1.5/skills/modern-python-toolchain/SKILL.md skills/modern-python-toolchain/
```

- [ ] **Step 3: Copy frontend-design**

```bash
mkdir -p skills/frontend-design
cp ~/.local/share/mimocode/builtin_skills/0.1.5/skills/frontend-design/SKILL.md skills/frontend-design/
```

- [ ] **Step 4: Commit**

```bash
git add skills/loop skills/modern-python-toolchain skills/frontend-design
git commit -m "feat: port loop, modern-python-toolchain, frontend-design skills from MiMoCode"
```

---

### Task 4: Copy document skills (docx, pdf, pptx, xlsx) with scripts and references

**Covers:** [S2]

**Files:**
- Create: `skills/docx-official/` (SKILL.md + scripts/ + references/)
- Create: `skills/pdf-official/` (SKILL.md + scripts/ + references/)
- Create: `skills/pptx-official/` (SKILL.md + scripts/ + references/)
- Create: `skills/xlsx-official/` (SKILL.md + scripts/ + references/)

**Source:** `~/.local/share/mimocode/builtin_skills/0.1.5/skills/<name>/`

- [ ] **Step 1: Copy docx-official**

```bash
mkdir -p skills/docx-official
cp -r ~/.local/share/mimocode/builtin_skills/0.1.5/skills/docx-official/* skills/docx-official/
```

- [ ] **Step 2: Copy pdf-official**

```bash
mkdir -p skills/pdf-official
cp -r ~/.local/share/mimocode/builtin_skills/0.1.5/skills/pdf-official/* skills/pdf-official/
```

- [ ] **Step 3: Copy pptx-official**

```bash
mkdir -p skills/pptx-official
cp -r ~/.local/share/mimocode/builtin_skills/0.1.5/skills/pptx-official/* skills/pptx-official/
```

- [ ] **Step 4: Copy xlsx-official**

```bash
mkdir -p skills/xlsx-official
cp -r ~/.local/share/mimocode/builtin_skills/0.1.5/skills/xlsx-official/* skills/xlsx-official/
```

- [ ] **Step 5: Verify scripts are present**

```bash
ls skills/docx-official/scripts/ skills/pdf-official/scripts/ skills/pptx-official/scripts/ skills/xlsx-official/scripts/
```

- [ ] **Step 6: Commit**

```bash
git add skills/docx-official skills/pdf-official skills/pptx-official skills/xlsx-official
git commit -m "feat: port docx/pdf/pptx/xlsx-official skills with scripts and references from MiMoCode"
```

---

### Task 5: Copy design-blueprint with references and assets

**Covers:** [S2]

**Files:**
- Create: `skills/design-blueprint/` (SKILL.md + assets/ + references/)

**Source:** `~/.local/share/mimocode/builtin_skills/0.1.5/skills/design-blueprint/`

- [ ] **Step 1: Copy design-blueprint**

```bash
mkdir -p skills/design-blueprint
cp -r ~/.local/share/mimocode/builtin_skills/0.1.5/skills/design-blueprint/* skills/design-blueprint/
```

- [ ] **Step 2: Verify companion files**

```bash
ls skills/design-blueprint/assets/ skills/design-blueprint/references/
```

- [ ] **Step 3: Commit**

```bash
git add skills/design-blueprint
git commit -m "feat: port design-blueprint skill with references and assets from MiMoCode"
```

---

### Task 6: Copy skill-creator with scripts and references

**Covers:** [S2]

**Files:**
- Create: `skills/skill-creator/` (SKILL.md + scripts/ + references/)

**Source:** `~/.local/share/mimocode/builtin_skills/0.1.5/skills/skill-creator/`

- [ ] **Step 1: Copy skill-creator**

```bash
mkdir -p skills/skill-creator
cp -r ~/.local/share/mimocode/builtin_skills/0.1.5/skills/skill-creator/* skills/skill-creator/
```

- [ ] **Step 2: Verify companion files**

```bash
ls skills/skill-creator/scripts/ skills/skill-creator/references/
```

- [ ] **Step 3: Commit**

```bash
git add skills/skill-creator
git commit -m "feat: port skill-creator skill with scripts and references from MiMoCode"
```

---

### Task 7: Copy and adapt evolve skill

**Covers:** [S2, S4]

**Files:**
- Create: `skills/evolve/SKILL.md`
- Create: `skills/evolve/reference/` (hook-api.md, tool-api.md, skill-api.md, tui-api.md)

**Source:** `~/.local/share/mimocode/builtin_skills/0.1.5/skills/evolve/`

- [ ] **Step 1: Copy evolve directory**

```bash
mkdir -p skills/evolve
cp -r ~/.local/share/mimocode/builtin_skills/0.1.5/skills/evolve/* skills/evolve/
```

- [ ] **Step 2: Adapt SKILL.md paths**

In `skills/evolve/SKILL.md`, replace all occurrences:
- `.mimocode/` → `.openzerocode/`
- `@mimo-ai/plugin` → the appropriate OpenZeroCode plugin import (check `src/tool/registry.ts` for the pattern)
- `@reference/` → `reference/` (relative paths within the skill)

- [ ] **Step 3: Adapt reference files if they exist**

If `skills/evolve/reference/` contains files, update any MiMoCode-specific paths.

- [ ] **Step 4: Commit**

```bash
git add skills/evolve
git commit -m "feat: port evolve skill adapted for OpenZeroCode from MiMoCode"
```

---

### Task 8: Create openzerocode skill (adapted from mimocode)

**Covers:** [S2, S4]

**Files:**
- Create: `skills/openzerocode/SKILL.md`
- Create: `skills/openzerocode/reference/guide.md`
- Create: `skills/openzerocode/reference/config.md`
- Create: `skills/openzerocode/reference/commands.md`
- Create: `skills/openzerocode/reference/permissions.md`
- Create: `skills/openzerocode/reference/workflows.md`

**Source:** `~/.local/share/mimocode/builtin_skills/0.1.5/skills/mimocode/`

- [ ] **Step 1: Copy mimocode reference files**

```bash
mkdir -p skills/openzerocode/reference
cp -r ~/.local/share/mimocode/builtin_skills/0.1.5/skills/mimocode/reference/* skills/openzerocode/reference/
```

- [ ] **Step 2: Create adapted SKILL.md**

Write `skills/openzerocode/SKILL.md` with content adapted from mimocode:
- Name: `openzerocode`
- Identity: "You are OpenZeroCode"
- Binary: `openzerocode` (not `mimo`)
- Config paths: `~/.config/openzerocode/` and `~/.local/share/openzerocode/`
- Feature map: TUI, build/plan/compose modes, provider switching, GEASS browser, 18 built-in tools, learn mode, session management, headless/server modes
- Compose skills: list the 15 compose skills (9 existing + 6 ported)
- Commands: update to match OpenZeroCode's actual commands
- Remove MiMoCode-specific features: voice, dream, distill, cron, goal, experimental.maxMode

- [ ] **Step 3: Adapt reference files**

Update all reference files to replace:
- `mimo` → `openzerocode`
- `~/.config/mimocode/` → `~/.config/openzerocode/`
- `~/.local/share/mimocode/` → `~/.local/share/openzerocode/`
- MiMoCode-specific feature references → OpenZeroCode equivalents

- [ ] **Step 4: Commit**

```bash
git add skills/openzerocode
git commit -m "feat: create openzerocode self-documenting skill adapted from MiMoCode"
```

---

### Task 9: Update system-prompt.ts to list new compose skills

**Covers:** [S5]

**Files:**
- Modify: `src/client/system-prompt.ts:79-116` (COMPOSE_MODE_REMINDER)

- [ ] **Step 1: Add new compose skills to COMPOSE_MODE_REMINDER**

In `src/client/system-prompt.ts`, update the `COMPOSE_MODE_REMINDER` array to include the 6 new compose skills in the "Available Compose Skills" list:

```typescript
"- **compose:ask** — Route decisions through the question tool. Use whenever you need user input.",
"- **compose:parallel** — Dispatch parallel agents for independent tasks.",
"- **compose:feedback** — Handle code review feedback with technical rigor.",
"- **compose:report** — Write final reports after implementation is verified.",
"- **compose:subagent** — Execute plans with fresh subagent per task and two-stage review.",
"- **compose:worktree** — Set up isolated workspaces via git worktrees.",
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS (no TypeScript errors)

- [ ] **Step 3: Commit**

```bash
git add src/client/system-prompt.ts
git commit -m "feat: register 6 new compose skills in system prompt"
```

---

### Task 10: Verify all skills load correctly

**Covers:** [S7]

- [ ] **Step 1: Verify compose skills directory structure**

```bash
ls -la skills/compose/
```

Expected: 15 directories (9 existing + 6 new)

- [ ] **Step 2: Verify builtin skills directory structure**

```bash
ls -d skills/*/
```

Expected: 11 directories (openzerocode, docx-official, pdf-official, pptx-official, xlsx-official, design-blueprint, frontend-design, skill-creator, evolve, loop, modern-python-toolchain)

- [ ] **Step 3: Verify all SKILL.md files exist**

```bash
find skills -name "SKILL.md" | wc -l
```

Expected: 26 (15 compose + 11 builtin)

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS

- [ ] **Step 5: Spot-check frontmatter**

Verify a few skills have correct frontmatter (name + description fields):
- `skills/compose/ask/SKILL.md`
- `skills/openzerocode/SKILL.md`
- `skills/docx-official/SKILL.md`

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: skill port adjustments"
```
