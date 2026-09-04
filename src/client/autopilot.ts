import type { RunOutcome } from "../server/types"

export type AutopilotDecision =
  | { action: "direct"; instruction: string; reason: string }
  | { action: "suggest"; instruction: string; reason: string }
  | { action: "accept"; reason: string }
  | { action: "blocked"; reason: string }

export type AutopilotMode = "off" | "standard" | "goal"
export type ActiveAutopilotMode = Exclude<AutopilotMode, "off">

/**
 * Whether the autopilot supervisor should be consulted after a run that ended
 * with the given outcome. `undefined` (no outcome recorded) and `completed`
 * both mean the run ended normally — autopilot should NOT be auto-consulted
 * because that would loop on every clean turn. Any other outcome (step
 * limit, provider error, tool error, or replan-needed) means the run terminated
 * in a way the supervisor can potentially recover from. Explicit user aborts
 * and internal application errors pause instead of starting another model turn.
 */
export function shouldAutopilotConsultOnOutcome(outcome: RunOutcome | undefined): boolean {
  if (!outcome) return false
  switch (outcome.kind) {
    case "completed":
    case "aborted":
    case "internal_error":
      return false
    case "step_limit_reached":
    case "provider_error":
    case "tool_error":
    case "replan_needed":
      return true
    default: {
      const exhaustive: never = outcome
      return exhaustive
    }
  }
}

/** Human-readable mode name for status, notices, and compact UI indicators. */
export function autopilotModeLabel(mode: AutopilotMode): string {
  switch (mode) {
    case "goal": return "Goal"
    case "standard": return "Standard"
    case "off": return "Off"
  }
}

/** Modes that keep retrying after a rate limit because they are advancing an approved goal. */
export function retriesAutopilotRateLimits(mode: AutopilotMode): boolean {
  return mode === "goal"
}

export const AUTOPILOT_RATE_LIMIT_BACKOFF_MS = [
  5 * 60_000,
  20 * 60_000,
  60 * 60_000,
  80 * 60_000,
  120 * 60_000,
  240 * 60_000,
]

export const AUTOPILOT_RATE_LIMIT_TOTAL_WAIT_MS = AUTOPILOT_RATE_LIMIT_BACKOFF_MS.reduce((sum, ms) => sum + ms, 0)

export function autopilotRateLimitDelayMs(attemptIndex: number, random = Math.random): number | undefined {
  const base = AUTOPILOT_RATE_LIMIT_BACKOFF_MS[attemptIndex]
  if (base === undefined) return undefined
  const jitter = Math.min(base * 0.1, 2 * 60_000)
  return Math.max(0, Math.round(base + ((random() * 2) - 1) * jitter))
}

export function formatAutopilotRetryDelay(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder === 0 ? `${hours}h` : `${hours}h${remainder}m`
}

export function formatAutopilotNoticeTime(date = new Date()): string {
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `${hours}:${minutes}`
}

export type AutopilotContinuationState = {
  enabled: boolean
  supervisorRunning: boolean
  rateLimitRetryPending: boolean
  running: boolean
  compacting: boolean
  awaitingApproval: boolean
  queuedInputCount: number
  inputQueueDraining: boolean
}

/** Whether an assistant turn is in a safe idle state for one continuation check. */
export function canScheduleAutopilotContinuation(state: AutopilotContinuationState): boolean {
  return state.enabled
    && !state.supervisorRunning
    && !state.rateLimitRetryPending
    && !state.running
    && !state.compacting
    && !state.awaitingApproval
    && state.queuedInputCount === 0
    && !state.inputQueueDraining
}

export function buildAutopilotSupervisorPrompt(mode: ActiveAutopilotMode): string {
  const common = [
    `You are the Autopilot supervisor for this OpenZeroCode session.`,
    `The human enabled Autopilot because they do not want to repeatedly type routine replies such as "OK, continue".`,
    `Review the conversation, especially the latest assistant response, and decide how to continue.`,
    `This check runs once after an assistant response. It is not a scheduled or polling task.`,
    ``,
    `Output ONLY valid JSON on one line (no markdown, no code block, no explanation).`,
    `The JSON must have an "action", "reason", and optionally an "instruction".`,
    `Decide exactly one action from the following four, in order of preference:`,
    ``,
    `1. "accept" — the current goal or task is now complete (or the human's explicit final answer was produced). The human expects no further automatic steps.`,
    `2. "suggest" — there is a safe, reversible, and repo-local next step the human would likely want to run, but it is not yet clearly authorized: either a sub-task inside a larger goal, a new idea, or anything outside the exact wording of the already-approved goal. Provide the prompt in "instruction". The human will press Enter to run it or Esc to decline.`,
    `3. "direct" — a previously approved goal or task is clearly unfinished, and its next step is exactly what the human already approved. Send that step without asking, as a continuation of the approved goal. Never use "direct" for new, unapproved, or expanded work.`,
    `4. "blocked" — continuing requires the human: a real product/design/requirements decision, credentials, external services, destructive or irreversible actions, a choice among multiple options, or the assistant is waiting for something only the human can provide. Do not run, and do not invent speculative work to keep the loop alive.`,
    ``,
    `Use "blocked" instead of "accept" when the goal is incomplete but the assistant is waiting on the human or the next step is ambiguous. Use "accept" when the goal is actually done or the requested task is complete.`,
    ``,
    `For "direct" or "suggest", write the concrete prompt the human would naturally send. Never say merely "continue" or "what next" when the intended action can be named. Never send two consecutive generic continuation requests.`,
  ]
  const standard = [
    `Autopilot mode: STANDARD. Answer routine continuation questions, but do not plan a new task after the requested task is complete.`,
    `Use "accept" once the current requested task is complete, even if the assistant offers optional follow-up work.`,
    `Use "suggest" when the assistant asks permission to run tests, fix discovered failures, complete verification, or perform another small step that is a natural part of finishing the current task.`,
    `Use "direct" only to continue the exact already-requested task (for example, the assistant asked whether to continue with the next clearly stated step of the task the human requested).`,
  ]
  const goal = [
    `Autopilot mode: GOAL. The human has stated an overall goal and wants it achieved. Treat the goal statement and any later clarifications as the scope boundary and source of truth. Advance the goal across multiple turns without asking, but never invent new work outside the approved goal and never run dangerous, destructive, or irreversible steps without asking.`,
    ``,
    `After each assistant response, follow this decision order:`,
    `1. Determine whether the stated goal is fully achieved and verified. If yes, use "accept" and stop.`,
    `2. If a planned sub-step of the approved goal is clearly incomplete (assistant stopped, asked whether to continue, hit a step limit, or needs a routine push), use "direct" with the concrete next instruction needed to finish that sub-step, for example "Continue; you are still working on <sub-task> of the approved goal".`,
    `3. If the assistant proposes a new action, a sub-task the human never mentioned, or a task that expands the approved goal, use "suggest" with its concrete prompt so the human can approve it.`,
    `4. If continuing requires a product/design/requirements decision, credentials, external services, destructive or irreversible actions, or the assistant is waiting on the human, use "blocked".`,
    ``,
    `Do not use "direct" to bootstrap new roadmap items, plan a fresh task, or authorize a proposal the human has not approved. Do not repeatedly ask for recommendations, optimizations, reviews, or follow-ups. When in doubt, use "blocked" and let the human decide.`,
  ]
  const safety = [
    `Use "blocked" when any of these apply:`,
    `- The overall goal is not complete and the next step needs a real product, design, or requirements decision`,
    `- There are multiple meaningful choices without one clearly recommended safe option`,
    `- Credentials, secrets, external services, destructive actions, or irreversible actions are involved`,
    `- The latest response is an error, a blocker, or does not contain a clear continuation point`,
    `- No further prompt is needed`,
    `Do not invent speculative features just to keep Autopilot running.`,
  ]
  return [...common, ...(mode === "goal" ? goal : standard), ``, ...safety].join("\n")
}

export function parseAutopilotDecision(text: string): AutopilotDecision {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
  try {
    const parsed = JSON.parse(cleaned)
    const action = parsed?.action
    const reason = typeof parsed?.reason === "string" ? parsed.reason : ""
    const instruction = typeof parsed?.instruction === "string" ? parsed.instruction.trim() : ""
    if (action === "accept") {
      return { action: "accept", reason }
    }
    if (action === "blocked") {
      return { action: "blocked", reason }
    }
    if (action === "direct") {
      if (instruction) return { action: "direct", instruction, reason }
    }
    if (action === "suggest") {
      if (instruction) return { action: "suggest", instruction, reason }
    }
  } catch {
    // Fall through to the conservative default.
  }
  return { action: "blocked", reason: "supervisor output was not valid JSON" }
}
