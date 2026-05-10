import { Effect, Context } from "effect"

const Action = { allow: "allow", deny: "deny", ask: "ask" } as const
type Action = (typeof Action)[keyof typeof Action]

type Rule = {
  permission: string
  pattern: string
  action: Action
}

type Reply = "once" | "always" | "reject"

function matchPattern(pattern: string, value: string): boolean {
  if (pattern === "*") return true
  const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$")
  return regex.test(value)
}

function evaluate(rule: Rule, permission: string, patterns: string[]): Action | null {
  if (!matchPattern(rule.permission, permission)) return null
  for (const p of patterns) {
    if (matchPattern(rule.pattern, p)) return rule.action
  }
  return null
}

function check(rules: Rule[], permission: string, patterns: string[]): Action {
  for (const rule of rules) {
    const act = evaluate(rule, permission, patterns)
    if (act) return act
  }
  return "ask"
}

export interface Interface {
  readonly ask: (input: {
    id: string
    permission: string
    patterns: string[]
    metadata?: Record<string, unknown>
  }) => Effect.Effect<Reply>
}

export class Permission extends Context.Service<Permission, Interface>()("@openzerocode/Permission") {}

export { evaluate, check, matchPattern }
export type { Rule, Reply }
