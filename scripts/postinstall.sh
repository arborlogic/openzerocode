#!/usr/bin/env bash
set -euo pipefail

OPTDIR="$(cd "$(dirname "$0")" && pwd)"
PROJDIR="$(cd "$OPTDIR/.." && pwd)"
cd "$PROJDIR"

# When installed from a local checkout (e.g. `npm install -g .`), ensure the
# CLI wrapper target exists. Always build with the local dev version suffix so
# the globally installed command reports a local/dev build distinctly.
echo "[openzerocode] Building local CLI binary at dist/openzerocode with dev version suffix..."
OPENZEROCODE_DEV_VERSION=1 bash "$PROJDIR/scripts/build.sh"
