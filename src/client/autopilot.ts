export type AutopilotDecision = {
  confidence: "high" | "low"
  instruction: string
  reason: string
}

export type AutopilotMode = "off" | "standard" | "proactive"
export type ActiveAutopilotMode = Exclude<AutopilotMode, "off">

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
    `Autopilot mode: PROACTIVE. In addition to routine continuation, plan and start the next appropriate task when a bounded subtask finishes.`,
    `Use "high" for the STANDARD cases and also when:`,
    `- The assistant completed and verified one bounded subtask, but the conversation or project roadmap shows broader work remains`,
    `- The latest report says no user action is required; in that case, continue with the highest-priority unfinished task that naturally follows`,
    ``,
    `Completing one implementation request is not the same as completing the overall project objective. Before choosing "low", inspect the full conversation for earlier recommendations, a roadmap, unfinished tasks, or a broader goal.`,
    ``,
    `If a bounded subtask just finished and the precise next item is not stated, use a prompt like:`,
    `"Review the current project state and conversation, choose the highest-priority unfinished repo-local task that follows this work, then implement and verify it. Stop only if a real product decision is required."`,
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
