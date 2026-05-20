#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run(command: list[str]) -> None:
    print(f"\n==> {' '.join(command)}")
    subprocess.run(command, cwd=ROOT, check=True)


def main() -> int:
    bun = shutil.which("bun")
    npm = shutil.which("npm")

    if not bun:
        print("Error: bun is required but was not found in PATH.", file=sys.stderr)
        return 1

    if not npm:
        print("Error: npm is required but was not found in PATH.", file=sys.stderr)
        return 1

    print(f"OpenZeroCode dev install from: {ROOT}")
    run([npm, "install"])
    run(["bash", "-lc", "OPENZEROCODE_DEV_VERSION=1 npm run build"])
    run([npm, "install", "-g", "."])

    print("\nDone. You can now run: openzerocode")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
