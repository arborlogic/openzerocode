export type AutopilotDecision = {
  confidence: "high" | "low"
  instruction: string
  reason: string
}

export type AutopilotMode = "off" | "standard" | "proactive"
export type ActiveAutopilotMode = Exclude<AutopilotMode, "off">

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
    `Autopilot mode: PROACTIVE. In addition to routine continuation, help move broader repo-local work forward after a bounded subtask finishes.`,
    `Use "high" for the STANDARD cases and also when:`,
    `- The assistant completed and verified one bounded subtask, but the conversation or project roadmap shows broader work remains`,
    `- The latest report proposes one clearly recommended next repo-local task, the proposal is reasonable, and no human decision or external approval is required`,
    ``,
    `Completing one implementation request is not the same as completing the overall project objective. Before choosing "low", inspect the full conversation for earlier recommendations, a roadmap, unfinished tasks, or a broader goal.`,
    ``,
    `When the previous work finished but the next task is not clear, do not invent and immediately implement a speculative task. Ask the current AI to propose the next step first.`,
    `For that case, use a prompt like:`,
    `"Review the current project state and conversation, propose the next highest-priority repo-local task, explain why it follows from the roadmap, and start implementing it only if the proposal is clearly safe, reasonable, and does not require a human product decision. Otherwise, stop with the proposal."`,
    ``,
    `When the latest assistant response is already a next-step proposal, use "high" only if it names one clearly recommended repo-local implementation, explains why it is reasonable, and explicitly does not require human intervention. Then write a concrete implementation prompt for that recommended task.`,
    `When continuing from a proposed next task, refine the next prompt before sending it. Preserve the proposal's intent, but add obvious engineering guardrails: keep scope small, preserve existing API/client contracts unless explicitly changing them, add or update tests, run relevant verification, update docs only when genuinely completed, and commit only if verification passes when the conversation expects committed work.`,
    `Do not pause merely because the proposed prompt would benefit from routine implementation safeguards. Add those safeguards yourself.`,
    ``,
    `Do not choose verification, review, testing, formatting, or committing as the next proactive task when the working tree appears clean and the previous task was already verified. Those are completion steps, not product progress. In that case, choose the next concrete roadmap, TODO, product, or API implementation item, then include verification and commit as final safeguards.`,
    `Use a verification-first prompt only when the latest response or repository state indicates unfinished local changes, failing tests, uncommitted work, or an interrupted implementation.`,
    `When the roadmap item is broad or architectural, choose a small vertical slice that moves a real production code path toward the target boundary. Prefer tasks that replace or reduce an existing coupling in handlers, services, or client flows over tasks that only add helper functions, contracts, notes, or tests around the edge.`,
    `Do not use Proactive Autopilot to request a progress explanation, justification, or retrospective when a safe implementation slice is available. Those are useful only when the human explicitly asks for them.`,
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
  return [...common, ...(mode === "proactive" ? proactive : standard), ``, ...safety].join("\n")
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
