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
OUTFILE="${1:-$PROJDIR/dist/openzerocode}"

cd "$PROJDIR"
echo "=== OpenZeroCode Build ==="
echo "Output: $OUTFILE"
echo ""

bun run scripts/build.ts "$OUTFILE"
