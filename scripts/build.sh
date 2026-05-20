#!/usr/bin/env bash
set -euo pipefail

# OpenZeroCode standalone binary build script
#
# Prerequisites: bun >= 1.2
#
# Usage:
#   ./scripts/build.sh                    # builds to ./dist/openzerocode
#   ./scripts/build.sh /path/to/output    # custom output path

OPTDIR="$(cd "$(dirname "$0")" && pwd)"
PROJDIR="$(cd "$OPTDIR/.." && pwd)"
OUTFILE="${1:-}"

cd "$PROJDIR"
echo "=== OpenZeroCode Build ==="
if [[ -n "$OUTFILE" ]]; then
  echo "Output: $OUTFILE"
else
  echo "Output: $PROJDIR/dist/openzerocode"
fi
echo ""

if [[ -n "$OUTFILE" ]]; then
  bun run scripts/build.ts "$OUTFILE"
else
  bun run scripts/build.ts
fi
