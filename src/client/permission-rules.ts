import type { PermissionRequest } from "../tool/types"

export type PermissionRule = {
  permission: string
  pattern: string
  action: "allow"
}

export function isSafePermission(permission: string) {
  return ["read", "grep", "glob", "web-fetch"].includes(permission)
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
