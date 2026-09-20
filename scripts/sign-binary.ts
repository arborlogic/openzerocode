import { execFileSync } from "node:child_process"

// Bun rebuilds replace the executable, invalidating any previous manual signature.
// Sign only after compilation and fail the build if signing or verification fails.
export function signBinary(
  outfile: string,
  platform: string = process.platform,
  run: (command: string, args: string[]) => void = (command, args) => {
    execFileSync(command, args, { stdio: "inherit" })
  },
): void {
  if (platform !== "darwin") return

  run("/usr/bin/codesign", ["--force", "--sign", "-", outfile])
  run("/usr/bin/codesign", ["--verify", "--verbose=4", outfile])
}
