---
name: github-issues
description: "Safely inspect, search, list, and create GitHub issues with repository detection, authentication checks, duplicate prevention, URL verification, and explicit external-side-effect reporting. Use when the user asks about GitHub issues or asks to create/file/report one."
---

# GitHub Issues

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
