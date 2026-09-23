---
name: github-issues
description: "Safely inspect and create GitHub issues and pull requests with repository detection, authentication checks, duplicate prevention, branch/upstream validation, result verification, and explicit external-side-effect reporting. Use when the user asks about GitHub issues or asks to create/file/report an issue or pull request."
---

# GitHub Issues and Pull Requests

Use the bundled script instead of composing ad hoc `gh` or API commands.

## Important

- Creating an issue is an **external side effect**. Follow the active permission policy before executing it.
- Never bypass duplicate protection until you have shown that each candidate is materially different.
- If creation reports an uncertain result, inspect the repository; do not retry blindly.

## Inspect or search

```sh
node skills/github-issues/scripts/github-issues.mjs inspect --query "search terms"
```

Add `--repo owner/repo` when the current `origin` is absent, is not GitHub, or the user specifies another repository. The command checks `gh` installation/authentication first and emits structured JSON.

## Create

1. Gather a clear title, Markdown body, and optional labels/assignees.
2. Run the create command. It searches open issues using the title before writing:

```sh
node skills/github-issues/scripts/github-issues.mjs create \
  --title "Concise issue title" \
  --body "Markdown issue body" \
  --label bug \
  --assignee octocat
```

3. If likely duplicates are returned, inspect them and stop unless the requested issue is demonstrably distinct. Only then rerun with `--allow-duplicate`.
4. Report the verified issue number and canonical URL from the JSON result.

The script prints `[external-side-effect]` before creation and returns `externalSideEffect: "github.issue.create"` on success for audit visibility.

## Pull requests

Inspect open pull requests for the current (or explicit) head branch without writing:

```sh
node skills/github-issues/scripts/github-issues.mjs pr-inspect
```

Review a pull request without checking out or modifying its branch:

```sh
node skills/github-issues/scripts/github-issues.mjs pr-review --pr 123
```

- `--pr` accepts a PR number, URL, or branch. Omit it to use the pull request associated with the current branch.
- The command returns structured PR metadata, changed-file details, check results, and the complete unified diff.
- Inspect the returned diff and relevant local source using the `review-helper` skill. Findings must cite changed files and precise lines, explain a concrete failure, and be ordered by priority.
- This command is read-only. Do not submit a GitHub review, approval, or change request unless the user explicitly asks for that external side effect.

Create a pull request only after reviewing the title/body and pushing every commit:

```sh
node skills/github-issues/scripts/github-issues.mjs pr-create \
  --title "Concise pull request title" \
  --body "Markdown pull request body"
```

- Add `--head branch`, `--base branch`, `--repo owner/repo`, or `--draft` when needed.
- The command refuses detached HEAD, identical head/base branches, missing upstreams, unpushed commits, and an existing open PR for the head branch.
- It resolves the repository default branch when `--base` is omitted, prints `[external-side-effect]` immediately before creation, then verifies the PR number, canonical URL, base branch, and head branch.
- On success, report the verified number and URL from the JSON result. If verification is uncertain, inspect GitHub and do not retry blindly.
