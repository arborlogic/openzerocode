import type { PermissionRequest } from "../tool/types"

export type PermissionRule = {
  permission: string
  pattern: string
  action: "allow"
}

export function isSafePermission(permission: string) {
  return ["read", "grep", "glob", "web_fetch"].includes(permission)
}

export function shouldAutoApprove(request: Omit<PermissionRequest, "id">, rules: PermissionRule[]) {
  if (isSafePermission(request.permission)) return true
  return request.patterns.every((pattern) =>
    rules.some((rule) => rule.permission === request.permission && (rule.pattern === "*" || rule.pattern === pattern)),
  )
}

export function addPermissionRules(
  rules: PermissionRule[],
  request: Omit<PermissionRequest, "id">,
): PermissionRule[] {
  const next = [...rules]
  for (const pattern of request.patterns) {
    if (next.some((rule) => rule.permission === request.permission && rule.pattern === pattern && rule.action === "allow")) {
      continue
    }
    next.push({ permission: request.permission, pattern, action: "allow" })
  }
  return next
}

// ── Dangerous bash command detection ──────────────────────────────────
// These patterns match bash commands that can delete or destroy data.
// Only the beginning of the command is checked (after normalizing).
// This is a best-effort guard, not a sandbox.

const DESTRUCTIVE_BASH_PATTERNS = [
  /^rm\s/,
  /^rmdir\s/,
  /^mv\s/,
  /^truncate\s/,
  /^shred\s/,
  /^dd\s/,
  /^>/,
]

/**
 * Strip leading env var assignments and `sudo` from a command string
 * so the destructive pattern check sees the actual command.
 *
 *   "VAR=val rm file"    -> "rm file"
 *   "sudo rm -rf /tmp"   -> "rm -rf /tmp"
 *   "VAR=a sudo rm file" -> "rm file"
 */
function normalizeCommand(command: string): string {
  let s = command.trim()
  // Strip leading env var assignments: VAR=val VAR2="val2" ...
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(s)) {
    s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s*/, "")
  }
  // Strip leading sudo
  s = s.replace(/^sudo\s+/, "")
  return s.trim()
}

/**
 * Returns true if the bash command can delete or destroy data.
 *
 * Only the first command in a chain (before `;`, `&&`, `||`, `|`, backtick)
 * is checked - chained destructive commands are a known bypass vector.
 */
export function isDangerousBashCommand(command: string): boolean {
  const normalized = normalizeCommand(command)
  return DESTRUCTIVE_BASH_PATTERNS.some((pattern) => pattern.test(normalized))
}
