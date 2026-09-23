#!/usr/bin/env node

import { spawnSync } from "node:child_process"

const args = process.argv.slice(2)
const command = args.shift()

function fail(message, details, exitCode = 1) {
  console.error(JSON.stringify({ ok: false, error: message, ...(details ? { details } : {}) }))
  process.exit(exitCode)
}

function option(name) {
  const index = args.indexOf(`--${name}`)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith("--")) fail(`--${name} requires a value`)
  return value
}

function options(name) {
  const values = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === `--${name}`) {
      const value = args[index + 1]
      if (!value || value.startsWith("--")) fail(`--${name} requires a value`)
      values.push(value)
    }
  }
  return values
}

function run(program, commandArgs) {
  const result = spawnSync(program, commandArgs, { encoding: "utf8" })
  if (result.error?.code === "ENOENT") {
    fail("GitHub CLI (gh) is not installed. Install it from https://cli.github.com/ and run `gh auth login`.")
  }
  if (result.status !== 0) {
    fail(`Command failed: ${program} ${commandArgs.join(" ")}`, (result.stderr || result.stdout).trim())
  }
  return result.stdout.trim()
}

function checkAuth() {
  const result = spawnSync("gh", ["auth", "status"], { encoding: "utf8" })
  if (result.error?.code === "ENOENT") {
    fail("GitHub CLI (gh) is not installed. Install it from https://cli.github.com/ and run `gh auth login`.")
  }
  if (result.status !== 0) {
    fail("GitHub authentication is required. Run `gh auth login`, then retry.", (result.stderr || result.stdout).trim())
  }
}

function normalizeRepo(value) {
  const match = value.match(/(?:github\.com[/:])([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) fail(`Cannot resolve a GitHub repository from: ${value}`)
  return `${match[1]}/${match[2]}`
}

function resolveRepo() {
  const explicit = option("repo")
  if (explicit) {
    if (/^[^/\s]+\/[^/\s]+$/.test(explicit)) return explicit.replace(/\.git$/, "")
    return normalizeRepo(explicit)
  }
  return normalizeRepo(run("git", ["remote", "get-url", "origin"]))
}

function parseJson(value, context) {
  try {
    return JSON.parse(value)
  } catch {
    fail(`Invalid JSON returned while ${context}`, value)
  }
}

function search(repo, query) {
  const output = run("gh", ["issue", "list", "--repo", repo, "--state", "open", "--search", query, "--limit", "10", "--json", "number,title,url"])
  return parseJson(output || "[]", "searching issues")
}

checkAuth()
const repo = resolveRepo()

if (command === "inspect") {
  const query = option("query") ?? ""
  console.log(JSON.stringify({ ok: true, repository: repo, issues: search(repo, query) }, null, 2))
} else if (command === "create") {
  const title = option("title")
  const body = option("body")
  if (!title) fail("create requires --title")
  if (!body) fail("create requires --body")

  const duplicates = search(repo, title)
  if (duplicates.length > 0 && !args.includes("--allow-duplicate")) {
    fail("Likely duplicate open issues found; review them before creating. Pass --allow-duplicate only after confirming the issue is distinct.", duplicates, 2)
  }

  const createArgs = ["issue", "create", "--repo", repo, "--title", title, "--body", body]
  for (const label of options("label")) createArgs.push("--label", label)
  for (const assignee of options("assignee")) createArgs.push("--assignee", assignee)

  console.error(`[external-side-effect] Creating GitHub issue in ${repo}`)
  const createdUrl = run("gh", createArgs).split(/\s+/).find((value) => /^https:\/\/github\.com\//.test(value))
  if (!createdUrl) fail("Issue may have been created, but gh did not return a verifiable GitHub URL. Check the repository before retrying.")

  const issue = parseJson(run("gh", ["issue", "view", createdUrl, "--repo", repo, "--json", "number,url,title"]), "verifying created issue")
  const expectedPrefix = `https://github.com/${repo}/issues/`
  if (!Number.isInteger(issue.number) || issue.url !== createdUrl || !issue.url.startsWith(expectedPrefix)) {
    fail("Created issue verification returned an unexpected number or URL. Check the repository before retrying.", issue)
  }
  console.log(JSON.stringify({ ok: true, externalSideEffect: "github.issue.create", repository: repo, issue }, null, 2))
} else {
  fail("Usage: github-issues.mjs inspect [--query text] [--repo owner/repo] | create --title text --body text [--label name] [--assignee login] [--repo owner/repo] [--allow-duplicate]")
}
