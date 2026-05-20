#!/usr/bin/env bash
set -euo pipefail

OPTDIR="$(cd "$(dirname "$0")" && pwd)"
PROJDIR="$(cd "$OPTDIR/.." && pwd)"
TARGET="${1:-}"

if [[ -z "$TARGET" ]]; then
  echo "Usage: $0 <darwin-arm64|linux-x64|linux-arm64|win32-x64>" >&2
  exit 1
fi

case "$TARGET" in
  darwin-arm64)
    RUNNER_OS="darwin"
    RUNNER_ARCH="arm64"
    BINARY_NAME="openzerocode"
    ;;
  linux-x64)
    RUNNER_OS="linux"
    RUNNER_ARCH="x64"
    BINARY_NAME="openzerocode"
    ;;
  linux-arm64)
    RUNNER_OS="linux"
    RUNNER_ARCH="arm64"
    BINARY_NAME="openzerocode"
    ;;
  win32-x64)
    RUNNER_OS="win32"
    RUNNER_ARCH="x64"
    BINARY_NAME="openzerocode.exe"
    ;;
  *)
    echo "Unsupported target: $TARGET" >&2
    exit 1
    ;;
esac

HOST_OS="$(node -p 'process.platform')"
HOST_ARCH="$(node -p 'process.arch')"
if [[ "$HOST_OS" != "$RUNNER_OS" || "$HOST_ARCH" != "$RUNNER_ARCH" ]]; then
  echo "Target $TARGET must be built on $RUNNER_OS-$RUNNER_ARCH; current host is $HOST_OS-$HOST_ARCH" >&2
  exit 1
fi

cd "$PROJDIR"
node scripts/create-platform-packages.mjs
PACKAGE_BIN_DIR="npm/packages/$TARGET/bin"
mkdir -p "$PACKAGE_BIN_DIR"
rm -f "$PACKAGE_BIN_DIR/$BINARY_NAME"
bun run scripts/build.ts "$PACKAGE_BIN_DIR/$BINARY_NAME"

if [[ ! -f "$PACKAGE_BIN_DIR/$BINARY_NAME" ]]; then
  echo "Retrying build from package directory to avoid Bun output path resolution issues..."
  (
    cd "npm/packages/$TARGET"
    bun run "$PROJDIR/scripts/build.ts" "./bin/$BINARY_NAME"
  )
fi
