export type AutopilotDecision = {
  confidence: "high" | "low"
  instruction: string
  reason: string
}

export type AutopilotMode = "off" | "standard" | "proactive" | "execute"
export type ActiveAutopilotMode = Exclude<AutopilotMode, "off">

/** Human-readable mode name for status, notices, and compact UI indicators. */
export function autopilotModeLabel(mode: AutopilotMode): string {
  switch (mode) {
    case "execute": return "Execute Plan"
    case "proactive": return "Proactive"
    case "standard": return "Standard"
    case "off": return "Off"
  }
}

/** Modes that keep retrying after a rate limit because they are advancing an approved plan. */
export function retriesAutopilotRateLimits(mode: AutopilotMode): boolean {
  return mode === "proactive" || mode === "execute"
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
    `Review the conversation, especially the latest assistant response, and decide whether to send the next user prompt.`,
    `This check runs once after an assistant response. It is not a scheduled or polling task.`,
    ``,
    `Output ONLY valid JSON on one line (no markdown, no code block, no explanation):`,
    `{"confidence":"high"|"low","instruction":"<next user prompt>","reason":"<brief rationale>"}`,
    ``,
    `Use "high" only when the next request is unambiguous, safe, reversible, and repo-local.`,
    `For "high", write the concrete prompt the human would naturally send. Do not merely say "continue" or "what next" when the intended action can be named.`,
    ``,
  ]
  const standard = [
    `Autopilot mode: STANDARD. Answer routine continuation questions, but do not plan a new task after the requested task is complete.`,
    `Use "high" for cases such as:`,
    `- The assistant asks whether it should continue with the next clearly stated implementation step`,
    `- The assistant asks permission to run tests, fix discovered failures, or complete verification`,
    `- The assistant recommends one clear repo-local next action and is waiting for a routine acknowledgment`,
    `Use "low" when the assistant completed the requested implementation and is only offering optional or newly planned follow-up work.`,
  ]
  const proactive = [
    `Autopilot mode: PROACTIVE. In addition to routine continuation, advance the human's existing plan after a bounded subtask finishes. Do not create an open-ended loop that repeatedly asks the coding agent to find more work.`,
    `Assume the human usually established a plan, TODO list, roadmap, or planning document before enabling Proactive mode. Treat that existing plan as the scope boundary and source of truth. A new idea being safe or repo-local is not enough by itself.`,
    ``,
    `After each assistant response, follow this decision order:`,
    `1. Identify the existing plan from the conversation: explicit user goals, an agreed TODO/roadmap/planning document, or unfinished tasks the assistant previously reported. Do not infer a broader objective merely from the repository having room for improvement.`,
    `2. Determine whether the latest assistant response completed a bounded step and whether it proposes a next action.`,
    `3. If it proposes a next action, quickly compare that proposal with the existing plan. Use "high" and tell the coding agent to implement it only when it clearly advances a specific unfinished plan item and requires no human decision.`,
    `4. If the proposal conflicts with, expands, reprioritizes, or is not clearly traceable to the existing plan, use "low" and an empty instruction so the human can decide. When uncertain, pause; do not ask the coding agent to justify the proposal or keep exploring.`,
    `5. If it does not propose a next action and unfinished planned work remains, use "high" to ask only: "Do you have a recommendation for what to do next? Compare it with the existing plan or TODOs and recommend one concrete next step. Do not implement it yet."`,
    `6. On the following response, evaluate that recommendation using steps 3 and 4. Never combine the recommendation request with permission to start implementation.`,
    ``,
    `A recommendation is aligned only when the conversation provides concrete evidence tying it to an unfinished item in the human-approved plan. Similar subject matter, general quality improvement, or a newly discovered optimization does not establish alignment.`,
    `If there is no identifiable existing plan, all planned items appear complete, or plan status is ambiguous, use "low". Do not bootstrap a new roadmap on the human's behalf.`,
    ``,
    `When continuing an aligned proposal, preserve its intent and name the plan item it advances. You may add obvious engineering guardrails: keep scope small, preserve existing API/client contracts unless the plan changes them, add or update tests, run relevant verification, update docs only when genuinely completed, and commit only if verification passes when the conversation expects committed work.`,
    `Review recent Autopilot-sent prompts. Never send two consecutive generic recommendation requests, and never repeatedly ask for the "next highest-priority", "next bottleneck", optimization, review, or follow-up after the agent has already supplied a recommendation. The next action after a recommendation must be either an aligned implementation prompt or a low-confidence pause.`,
    `Do not pause merely because the proposed prompt would benefit from routine implementation safeguards. Add those safeguards yourself.`,
    ``,
    `Do not choose verification, review, testing, formatting, or committing as a new proactive task when the previous planned step was already verified. Those are completion steps, not evidence of more planned product work.`,
    `Use a verification-first prompt only when the latest response or repository state indicates unfinished local changes, failing tests, uncommitted work, or an interrupted implementation.`,
    `Do not use Proactive Autopilot to request a progress explanation, justification, retrospective, fresh plan, or speculative repository review.`,
  ]
  const execute = [
    `Autopilot mode: EXECUTE PLAN. The human has already supplied or approved a concrete TODO list, implementation plan, roadmap, or ordered task list and wants uninterrupted implementation. Treat that list as an authorization boundary and work through it continuously.`,
    ``,
    `This is execution, not planning. Do not ask the coding agent to recommend, discover, prioritize, explain, review, or re-plan the next task. Do not send a generic "continue" prompt when a concrete unfinished task can be identified from the approved list.`,
    ``,
    `After every bounded response, identify the next incomplete approved task from the conversation, task list, or plan document. If one exists, use "high" and instruct the coding agent to implement that exact task now. Preserve task order unless the approved plan explicitly permits parallel work or dependencies require a different order.`,
    `In each continuation prompt, tell the coding agent to: complete the selected task end-to-end; make appropriately scoped changes and tests; run focused verification; mark the task complete; then immediately continue to the next approved task in the same response whenever possible. Do not stop for routine status updates, confirmation, or optional improvements.`,
    `Do not request per-task code review, broad repository review, formatting-only work, commits, reports, or retrospective work. Those happen once at the end of the approved list, unless a task explicitly requires them.`,
    `When all approved implementation tasks are complete, use "high" exactly once to request final integrated verification and a single focused review of the accumulated changes. After that response, use "low" unless it exposes a concrete defect required to satisfy an approved task.`,
    `Use "low" and an empty instruction only when the plan is absent or exhausted, a genuine blocker or repeated verification failure needs human input, a task is ambiguous, or continuing would leave the approved scope. Do not invent work to keep the loop alive.`,
  ]
  const safety = [
    `Use "low" and an empty instruction when any of these apply:`,
    `- The overall session objective is explicitly complete and no meaningful next repo-local work is evident`,
    `- The assistant asks for a real product, design, or requirements decision`,
    `- There are multiple meaningful choices without one clearly recommended safe option`,
    `- Credentials, secrets, external services, destructive actions, or irreversible actions are involved`,
    `- The latest response is an error, a blocker, or does not contain a clear continuation point`,
    `- No further prompt is needed`,
    `Do not invent speculative features just to keep Autopilot running.`,
  ]
  return [...common, ...(mode === "execute" ? execute : mode === "proactive" ? proactive : standard), ``, ...safety].join("\n")
}

export function parseAutopilotDecision(text: string): AutopilotDecision {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
  try {
    const parsed = JSON.parse(cleaned)
    const validConfidence = parsed?.confidence === "high" || parsed?.confidence === "low"
    const hasInstruction = typeof parsed?.instruction === "string" && parsed.instruction.trim().length > 0
    if (validConfidence && (hasInstruction || parsed.confidence === "low")) {
      return {
        confidence: parsed.confidence,
        instruction: typeof parsed.instruction === "string" ? parsed.instruction.trim() : "",
        reason: typeof parsed.reason === "string" ? parsed.reason : "",
      }
    }
  } catch {
    // Fall through to the conservative default.
  }
  return { confidence: "low", instruction: "", reason: "supervisor output was not valid JSON" }
}
