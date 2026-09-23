import assert from "node:assert/strict"
import { afterEach, describe, it } from "node:test"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"

const script = resolve("skills/github-issues/scripts/github-issues.mjs")
const workspaces: string[] = []

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true })
})

function run(scenario: string, extraArgs: string[] = []) {
  const workspace = mkdtempSync(join(tmpdir(), "ozc-github-issues-"))
  workspaces.push(workspace)
  const log = join(workspace, "calls.log")
  const gh = join(workspace, "gh")
  writeFileSync(gh, `#!/bin/sh
echo "$@" >> "$GH_TEST_LOG"
if [ "$1 $2" = "auth status" ]; then [ "$GH_SCENARIO" != "auth-fail" ]; exit; fi
if [ "$1 $2" = "issue list" ]; then
  [ "$GH_SCENARIO" = "api-fail" ] && echo "API unavailable" >&2 && exit 1
  [ "$GH_SCENARIO" = "duplicate" ] && echo '[{"number":7,"title":"Duplicate","url":"https://github.com/acme/widget/issues/7"}]' || echo '[]'
  exit
fi
if [ "$1 $2" = "issue create" ]; then echo 'https://github.com/acme/widget/issues/42'; exit; fi
if [ "$1 $2" = "issue view" ]; then echo '{"number":42,"url":"https://github.com/acme/widget/issues/42","title":"Bug"}'; exit; fi
exit 1
`)
  chmodSync(gh, 0o755)
  const result = spawnSync(process.execPath, [script, "create", "--repo", "acme/widget", "--title", "Bug", "--body", "Details", ...extraArgs], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${workspace}:${process.env.PATH}`, GH_SCENARIO: scenario, GH_TEST_LOG: log },
  })
  return { ...result, calls: readFileSync(log, "utf8") }
}

function runPullRequest(scenario: string, extraArgs: string[] = []) {
  const workspace = mkdtempSync(join(tmpdir(), "ozc-github-pr-"))
  workspaces.push(workspace)
  const log = join(workspace, "calls.log")
  const command = (name: string, contents: string) => {
    const path = join(workspace, name)
    writeFileSync(path, contents)
    chmodSync(path, 0o755)
  }
  command("gh", `#!/bin/sh
echo "$@" >> "$GH_TEST_LOG"
if [ "$1 $2" = "auth status" ]; then exit 0; fi
if [ "$1 $2" = "repo view" ]; then echo '{"defaultBranchRef":{"name":"main"}}'; exit; fi
if [ "$1 $2" = "pr list" ]; then
  [ "$GH_SCENARIO" = "duplicate-pr" ] && echo '[{"number":8,"url":"https://github.com/acme/widget/pull/8","headRefName":"feature","baseRefName":"main"}]' || echo '[]'
  exit
fi
if [ "$1 $2" = "pr create" ]; then echo 'https://github.com/acme/widget/pull/42'; exit; fi
if [ "$1 $2" = "pr view" ]; then
  [ "$GH_SCENARIO" = "review-fail" ] && echo 'PR unavailable' >&2 && exit 1
  echo '{"number":42,"url":"https://github.com/acme/widget/pull/42","title":"Feature","body":"Details","author":{"login":"octocat"},"baseRefName":"main","headRefName":"feature","isDraft":false,"state":"OPEN","mergeable":"MERGEABLE","reviewDecision":"","additions":5,"deletions":1,"changedFiles":1,"files":[{"path":"src/index.ts","additions":5,"deletions":1}],"statusCheckRollup":[]}'
  exit
fi
if [ "$1 $2" = "pr diff" ]; then
  if [ "$GH_SCENARIO" = "large-diff" ]; then
    printf 'diff --git a/src/index.ts b/src/index.ts\n'
    dd if=/dev/zero bs=1048576 count=2 2>/dev/null | tr '\\0' x
    exit
  fi
  if [ "$GH_SCENARIO" = "large-diff-fail" ]; then
    dd if=/dev/zero bs=1048576 count=2 2>/dev/null | tr '\\0' x >&2
    exit 1
  fi
  echo 'diff --git a/src/index.ts b/src/index.ts'
  exit
fi
exit 1
`)
  command("git", `#!/bin/sh
echo "$@" >> "$GH_TEST_LOG"
if [ "$1 $2" = "branch --show-current" ]; then echo feature; exit; fi
if [ "$1 $2" = "rev-parse --abbrev-ref" ]; then [ "$GH_SCENARIO" != "no-upstream" ] && echo origin/feature; exit; fi
if [ "$1 $2" = "rev-list --count" ]; then [ "$GH_SCENARIO" = "unpushed" ] && echo 2 || echo 0; exit; fi
exit 1
`)
  const result = spawnSync(process.execPath, [script, "pr-create", "--repo", "acme/widget", "--title", "Feature", "--body", "Details", ...extraArgs], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${workspace}:${process.env.PATH}`, GH_SCENARIO: scenario, GH_TEST_LOG: log },
  })
  return { ...result, calls: readFileSync(log, "utf8"), workspace, log }
}

describe("GitHub issue workflow", () => {
  it("creates and verifies an issue with explicit side-effect output", () => {
    const result = run("success", ["--label", "bug", "--assignee", "octocat"])
    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.externalSideEffect, "github.issue.create")
    assert.equal(output.issue.number, 42)
    assert.equal(output.issue.url, "https://github.com/acme/widget/issues/42")
    assert.match(result.stderr, /\[external-side-effect\]/)
    assert.match(result.calls, /issue list.*Bug/)
    assert.match(result.calls, /issue create.*--label bug.*--assignee octocat/)
    assert.match(result.calls, /issue view https:\/\/github.com\/acme\/widget\/issues\/42/)
  })

  it("stops before repository access when authentication fails", () => {
    const result = run("auth-fail")
    assert.equal(result.status, 1)
    assert.match(result.stderr, /gh auth login/)
    assert.doesNotMatch(result.calls, /issue/)
  })

  it("blocks likely duplicates before creation", () => {
    const result = run("duplicate")
    assert.equal(result.status, 2)
    assert.match(result.stderr, /Likely duplicate/)
    assert.doesNotMatch(result.calls, /issue create/)
  })

  it("reports CLI failures without attempting creation", () => {
    const result = run("api-fail")
    assert.equal(result.status, 1)
    assert.match(result.stderr, /API unavailable/)
    assert.doesNotMatch(result.calls, /issue create/)
  })
})

describe("GitHub pull request workflow", () => {
  it("returns review metadata, changed files, checks, and the diff without writing", () => {
    const fixture = runPullRequest("success")
    writeFileSync(fixture.log, "")
    const result = spawnSync(process.execPath, [script, "pr-review", "--repo", "acme/widget", "--pr", "42"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${fixture.workspace}:${process.env.PATH}`, GH_SCENARIO: "success", GH_TEST_LOG: fixture.log },
    })
    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.pullRequest.number, 42)
    assert.equal(output.pullRequest.files[0].path, "src/index.ts")
    assert.match(output.diff, /diff --git/)
    const calls = readFileSync(fixture.log, "utf8")
    assert.match(calls, /pr view 42.*statusCheckRollup/)
    assert.match(calls, /pr diff 42 --repo acme\/widget/)
    assert.doesNotMatch(calls, /pr review|pr comment/)
  })

  it("returns a pull request diff larger than spawnSync's 1 MiB default buffer", () => {
    const fixture = runPullRequest("large-diff")
    writeFileSync(fixture.log, "")
    const result = spawnSync(process.execPath, [script, "pr-review", "--repo", "acme/widget", "--pr", "42"], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, PATH: `${fixture.workspace}:${process.env.PATH}`, GH_SCENARIO: "large-diff", GH_TEST_LOG: fixture.log },
    })
    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.ok(output.diff.length > 1024 * 1024)
    assert.match(output.diff, /^diff --git/)
  })

  it("bounds command output included in failure details", () => {
    const fixture = runPullRequest("large-diff-fail")
    writeFileSync(fixture.log, "")
    const result = spawnSync(process.execPath, [script, "pr-review", "--repo", "acme/widget", "--pr", "42"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${fixture.workspace}:${process.env.PATH}`, GH_SCENARIO: "large-diff-fail", GH_TEST_LOG: fixture.log },
    })
    assert.equal(result.status, 1)
    const output = JSON.parse(result.stderr)
    assert.equal(output.error, "Cannot fetch the pull request diff.")
    assert.match(output.details, /\[error details truncated\]$/)
    assert.ok(result.stderr.length < 16 * 1024)
  })

  it("reports a PR lookup failure without fetching a diff", () => {
    runPullRequest("review-fail")
    const workspace = workspaces.at(-1)!
    writeFileSync(join(workspace, "calls.log"), "")
    const result = spawnSync(process.execPath, [script, "pr-review", "--repo", "acme/widget", "--pr", "999"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${workspace}:${process.env.PATH}`, GH_SCENARIO: "review-fail", GH_TEST_LOG: join(workspace, "calls.log") },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Cannot resolve the pull request/)
    assert.doesNotMatch(readFileSync(join(workspace, "calls.log"), "utf8"), /pr diff/)
  })

  it("checks the pushed branch, creates a PR, and verifies its refs", () => {
    const result = runPullRequest("success")
    assert.equal(result.status, 0, result.stderr)
    const output = JSON.parse(result.stdout)
    assert.equal(output.externalSideEffect, "github.pull_request.create")
    assert.equal(output.pullRequest.number, 42)
    assert.match(result.stderr, /\[external-side-effect\]/)
    assert.match(result.calls, /rev-parse.*feature@\{upstream\}/)
    assert.match(result.calls, /pr create.*--head feature.*--base main/)
    assert.match(result.calls, /pr view https:\/\/github.com\/acme\/widget\/pull\/42/)
  })

  it("blocks creation when commits have not been pushed", () => {
    const result = runPullRequest("unpushed")
    assert.equal(result.status, 1)
    assert.match(result.stderr, /2 unpushed commit/)
    assert.doesNotMatch(result.calls, /pr create/)
  })

  it("blocks creation when the head already has an open PR", () => {
    const result = runPullRequest("duplicate-pr")
    assert.equal(result.status, 2)
    assert.match(result.stderr, /already exists/)
    assert.doesNotMatch(result.calls, /pr create/)
  })
})
