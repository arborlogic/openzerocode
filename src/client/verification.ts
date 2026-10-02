import { existsSync, readFileSync } from "fs"
import { join } from "path"

const VERIFY_PATTERNS = [
  /(^|\s)(npm|pnpm|yarn|bun)\s+(run\s+)?(test|typecheck|lint|build|check)(\s|$)/i,
  /(^|\s)npx\s+[^;&|]*\b(test|lint|check|typecheck)\b/i,
  /(^|\s)(go\s+test|go\s+vet|cargo\s+(test|check|clippy)|pytest|python\s+-m\s+pytest|swift\s+test|xcodebuild|flutter\s+(test|analyze|build)|gradle\s+test|\.\/gradlew\s+test)(\s|$)/i,
]

const MUTATING_TOOL_IDS = new Set(["write", "edit", "apply_patch"])

export function isWorkspaceMutatingTool(tool: string): boolean {
  return MUTATING_TOOL_IDS.has(tool)
}

export function isVerificationCommand(command: string): boolean {
  const normalized = command.trim()
  return VERIFY_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function inferVerificationCommands(workdir: string): string[] {
  const commands: string[] = []

  if (existsSync(join(workdir, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(workdir, "package.json"), "utf-8")) as { scripts?: Record<string, string> }
      if (pkg.scripts?.typecheck) commands.push("npm run typecheck")
      if (pkg.scripts?.test) commands.push("npm test")
      else if (pkg.scripts?.build) commands.push("npm run build")
      else if (pkg.scripts?.lint) commands.push("npm run lint")
    } catch {
      // Ignore malformed package metadata; other repository markers can still help.
    }
  }
  if (existsSync(join(workdir, "go.mod"))) commands.push("go test ./...")
  if (existsSync(join(workdir, "Cargo.toml"))) commands.push("cargo test")
  if (existsSync(join(workdir, "pyproject.toml")) || existsSync(join(workdir, "pytest.ini"))) commands.push("pytest")
  if (existsSync(join(workdir, "Package.swift"))) commands.push("swift test")
  if (existsSync(join(workdir, "pubspec.yaml"))) commands.push("flutter test")

  return [...new Set(commands)].slice(0, 3)
}
