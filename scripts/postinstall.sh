#!/usr/bin/env bash
set -euo pipefail

OPTDIR="$(cd "$(dirname "$0")" && pwd)"
PROJDIR="$(cd "$OPTDIR/.." && pwd)"
cd "$PROJDIR"

# In this repo we want local checkout installs (e.g. `npm install -g .`) to
# produce a runnable dev binary, but CI/package builds should not do extra work
# or fail if Bun skips compile output in an install context.
#
# GitHub Actions packaging jobs invoke `bun install --frozen-lockfile` before the
# dedicated build step. Detect CI and skip the local dev binary build there.
if [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]; then
  echo "[openzerocode] Skipping local dev binary build during CI install."
  exit 0
fi

# When installed from a local checkout (e.g. `npm install -g .`), ensure the
# CLI wrapper target exists. Always build with the local dev version suffix so
# the globally installed command reports a local/dev build distinctly.
echo "[openzerocode] Building local CLI binary at dist/openzerocode with dev version suffix..."
OPENZEROCODE_DEV_VERSION=1 bash "$PROJDIR/scripts/build.sh"

# Best-effort validation: local installs should leave behind the expected binary.
BINARY_PATH="$PROJDIR/dist/openzerocode"
if [[ "$(node -p 'process.platform')" == "win32" ]]; then
  BINARY_PATH="$PROJDIR/dist/openzerocode.exe"
fi

if [[ ! -f "$BINARY_PATH" ]]; then
  echo "[openzerocode] Expected local binary missing after build: $BINARY_PATH" >&2
  exit 1
fi
