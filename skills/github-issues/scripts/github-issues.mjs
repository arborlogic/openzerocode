#!/usr/bin/env node

import { spawnSync } from "node:child_process"

const args = process.argv.slice(2)
const command = args.shift()
const MAX_COMMAND_OUTPUT_BYTES = 64 * 1024 * 1024
const MAX_ERROR_DETAILS_CHARS = 8 * 1024

function boundedDetails(details) {
  if (typeof details !== "string" || details.length <= MAX_ERROR_DETAILS_CHARS) return details
  return `${details.slice(0, MAX_ERROR_DETAILS_CHARS)}\n...[error details truncated]`
}

function fail(message, details, exitCode = 1) {
  const safeDetails = boundedDetails(details)
  console.error(JSON.stringify({ ok: false, error: message, ...(safeDetails ? { details: safeDetails } : {}) }))
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

function execute(program, commandArgs) {
  return spawnSync(program, commandArgs, { encoding: "utf8", maxBuffer: MAX_COMMAND_OUTPUT_BYTES })
}

function run(program, commandArgs, remediation) {
  const result = execute(program, commandArgs)
  if (result.error?.code === "ENOENT") {
    if (program === "gh") fail("GitHub CLI (gh) is not installed. Install it from https://cli.github.com/ and run `gh auth login`.")
    fail(`${program} is required but was not found.`)
  }
  if (result.status !== 0) {
    fail(remediation ?? `Command failed: ${program} ${commandArgs.join(" ")}`, (result.stderr || result.stdout).trim())
  }
  return result.stdout.trim()
}

function checkAuth() {
  const result = execute("gh", ["auth", "status"])
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

function searchIssues(repo, query) {
  const output = run("gh", ["issue", "list", "--repo", repo, "--state", "open", "--search", query, "--limit", "10", "--json", "number,title,url"])
  return parseJson(output || "[]", "searching issues")
}

function currentBranch() {
  const branch = option("head") ?? run("git", ["branch", "--show-current"], "Cannot determine the current branch. Check out a named branch or pass --head.")
  if (!branch || branch === "HEAD") fail("Cannot create a pull request from detached HEAD. Check out a named branch or pass --head.")
  return branch
}

function defaultBase(repo) {
  return option("base") ?? parseJson(
    run("gh", ["repo", "view", repo, "--json", "defaultBranchRef"]),
    "resolving the default branch",
  ).defaultBranchRef?.name ?? fail("Cannot determine the repository default branch. Pass --base explicitly.")
}

function openPullRequests(repo, head) {
  return parseJson(
    run("gh", ["pr", "list", "--repo", repo, "--state", "open", "--head", head, "--json", "number,title,url,baseRefName,headRefName"]),
    "checking for an existing pull request",
  )
}

function checkBranchIsPushed(head) {
  const upstream = execute("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${head}@{upstream}`])
  if (upstream.status !== 0) {
    fail(`Branch ${head} has no upstream. Push it first with \`git push -u origin ${head}\`; no pull request was created.`)
  }
  const unpushed = run("git", ["rev-list", "--count", `${head}@{upstream}..${head}`], `Cannot compare ${head} with its upstream.`)
  if (unpushed !== "0") {
    fail(`Branch ${head} has ${unpushed} unpushed commit(s). Push the branch before creating a pull request; no pull request was created.`)
  }
}

function pullRequestReview(repo) {
  const target = option("pr")
  const viewArgs = ["pr", "view"]
  if (target) viewArgs.push(target)
  viewArgs.push(
    "--repo", repo,
    "--json", "number,title,url,body,author,baseRefName,headRefName,isDraft,state,mergeable,reviewDecision,additions,deletions,changedFiles,files,statusCheckRollup",
  )
  const pullRequest = parseJson(run("gh", viewArgs, "Cannot resolve the pull request to review. Pass --pr with a PR number, URL, or branch."), "inspecting the pull request")
  const expectedPrefix = `https://github.com/${repo}/pull/`
  if (!Number.isInteger(pullRequest.number) || !pullRequest.url?.startsWith(expectedPrefix)) {
    fail("Pull request inspection returned an unexpected number or URL.", pullRequest)
  }

  const diffArgs = ["pr", "diff", String(pullRequest.number), "--repo", repo]
  const diff = run("gh", diffArgs, "Cannot fetch the pull request diff.")
  console.log(JSON.stringify({ ok: true, repository: repo, pullRequest, diff }, null, 2))
}

checkAuth()
const repo = resolveRepo()

if (command === "inspect") {
  const query = option("query") ?? ""
  console.log(JSON.stringify({ ok: true, repository: repo, issues: searchIssues(repo, query) }, null, 2))
} else if (command === "create") {
  const title = option("title")
  const body = option("body")
  if (!title) fail("create requires --title")
  if (!body) fail("create requires --body")

  const duplicates = searchIssues(repo, title)
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
} else if (command === "pr-inspect") {
  const head = currentBranch()
  console.log(JSON.stringify({ ok: true, repository: repo, head, pullRequests: openPullRequests(repo, head) }, null, 2))
} else if (command === "pr-review") {
  pullRequestReview(repo)
} else if (command === "pr-create") {
  const title = option("title")
  const body = option("body")
  if (!title) fail("pr-create requires --title")
  if (!body) fail("pr-create requires --body")

  const head = currentBranch()
  const base = defaultBase(repo)
  if (head === base) fail(`Head and base branches are both ${head}. Create or check out a feature branch first.`)
  checkBranchIsPushed(head)

  const existing = openPullRequests(repo, head)
  if (existing.length > 0) {
    fail(`An open pull request already exists for ${head}; no pull request was created.`, existing, 2)
  }

  console.error(`[external-side-effect] Creating GitHub pull request in ${repo}: ${head} -> ${base}`)
  const createArgs = ["pr", "create", "--repo", repo, "--head", head, "--base", base, "--title", title, "--body", body]
  if (args.includes("--draft")) createArgs.push("--draft")
  const createdUrl = run("gh", createArgs).split(/\s+/).find((value) => /^https:\/\/github\.com\//.test(value))
  if (!createdUrl) fail("Pull request may have been created, but gh did not return a verifiable GitHub URL. Check the repository before retrying.")

  const pullRequest = parseJson(
    run("gh", ["pr", "view", createdUrl, "--repo", repo, "--json", "number,url,title,baseRefName,headRefName,isDraft"]),
    "verifying created pull request",
  )
  const expectedPrefix = `https://github.com/${repo}/pull/`
  if (
    !Number.isInteger(pullRequest.number)
    || pullRequest.url !== createdUrl
    || !pullRequest.url.startsWith(expectedPrefix)
    || pullRequest.baseRefName !== base
    || pullRequest.headRefName !== head
  ) {
    fail("Created pull request verification returned an unexpected number, URL, base, or head. Check the repository before retrying.", pullRequest)
  }
  console.log(JSON.stringify({ ok: true, externalSideEffect: "github.pull_request.create", repository: repo, pullRequest }, null, 2))
} else {
  fail("Usage: github-issues.mjs inspect|create|pr-inspect|pr-review|pr-create [options]. Read the github-issues skill for command details.")
}
