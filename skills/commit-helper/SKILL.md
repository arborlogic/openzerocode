---
name: commit-helper
description: "Smart git commit message generator following Conventional Commits. Use when the user says 'commit', 'commit this', 'write a commit message', 'smart commit', or asks to create a git commit."
---

# Commit Helper

Generate meaningful git commit messages by analyzing staged changes.

## When to use

- User says "commit" or "commit this"
- User asks to write a commit message
- User wants a smart commit

## Workflow

1. Run `git diff --cached --stat` to see staged files
2. Run `git diff --cached` to see the actual changes
3. Run `git log --oneline -5` to see recent commit style
4. Analyze the changes and generate a Conventional Commit message

## Commit message format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Formatting, no code change
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: Performance improvement
- `test`: Adding or updating tests
- `chore`: Build process, dependencies, or tooling changes
- `ci`: CI configuration changes

### Rules

- Use imperative mood in the description ("add feature" not "added feature")
- Don't capitalize the first letter of the description
- No period at the end of the description
- Keep the description under 72 characters
- Use the scope to indicate the area of change (e.g., `auth`, `ui`, `api`)
- Reference issues in the footer: `Closes #123`

## Example

For a change that adds user authentication:

```
feat(auth): add JWT-based user authentication

Implement login/logout endpoints with JWT token generation.
Tokens expire after 24 hours and can be refreshed.

Closes #42
```
