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
