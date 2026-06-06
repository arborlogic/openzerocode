export type AutoLoopDuration = {
  ms: number
  label: string
}

export type SupervisorDecision = {
  confidence: "high" | "low" | "pending"
  instruction: string
  reason: string
}

const DURATION_RE = /^(\d+(?:\.\d+)?)(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i

export function parseAutoLoopDuration(input: string): AutoLoopDuration | undefined {
  const raw = input.trim().toLowerCase()
  const match = raw.match(DURATION_RE)
  if (!match) return undefined

  const value = Number.parseFloat(match[1]!)
  if (!Number.isFinite(value) || value <= 0) return undefined

  const unit = match[2]!
  const multiplier = unit.startsWith("s") ? 1_000
    : unit.startsWith("m") ? 60_000
    : unit.startsWith("h") ? 60 * 60_000
    : 24 * 60 * 60_000
  const ms = Math.round(value * multiplier)
  if (!Number.isFinite(ms) || ms <= 0) return undefined

  const label = `${match[1]}${unit[0]}`
  return { ms, label }
}

export function formatAutoLoopDuration(ms: number): string {
  if (ms % (24 * 60 * 60_000) === 0) return `${ms / (24 * 60 * 60_000)}d`
  if (ms % (60 * 60_000) === 0) return `${ms / (60 * 60_000)}h`
  if (ms % 60_000 === 0) return `${ms / 60_000}m`
  if (ms % 1_000 === 0) return `${ms / 1_000}s`
  return `${ms}ms`
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0")
}

export function formatAutoLoopLocalTime(timestampMs: number): string {
  const date = new Date(timestampMs)
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? "+" : "-"
  const absOffset = Math.abs(offsetMinutes)
  const offsetHours = Math.floor(absOffset / 60)
  const offsetRemainder = absOffset % 60
  return [
    `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`,
    `${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`,
    `GMT${sign}${padDatePart(offsetHours)}:${padDatePart(offsetRemainder)}`,
  ].join(" ")
}

export function formatAutoLoopEstimatedEnd(timestampMs: number): string {
  return `autorun 接管到 ${formatAutoLoopLocalTime(timestampMs)}`
}

export function buildAutoLoopSupervisorPrompt(remainingLabel: string): string {
  return [
    `You are the autoloop supervisor for this OpenZeroCode session.`,
    `The human has delegated the next ${remainingLabel} to AI to continue work autonomously.`,
    ``,
    `Review the conversation history above and decide the single best next action.`,
    ``,
    `Output ONLY valid JSON on one line (no markdown, no code block, no explanation):`,
    `{"confidence":"high"|"low"|"pending","instruction":"<next instruction>","reason":"<brief rationale>"}`,
    ``,
    `confidence values:`,
    ``,
    `"high" — proceed immediately. Use when ALL of the following are true:`,
    `- The next step is unambiguous (the last reply clearly states what comes next, or the task is in progress)`,
    `- The action is safe, reversible, and repo-local (read, edit, test, typecheck, lint, fix, commit)`,
    `- No credentials, secrets, or external services are needed`,
    `- The session goal is not yet complete`,
    ``,
    `"pending" — wait 3 minutes for human response, then proceed with the recommended option. Use when:`,
    `- The last assistant reply presented multiple options AND included a clear recommendation`,
    `- The recommended action is safe and repo-local`,
    `- Set instruction to exactly what the AI recommended doing`,
    ``,
    `"low" — stop and wait for human. Use when ANY of the following:`,
    `- No recommendation was given and requirements are ambiguous`,
    `- Credentials, secrets, or an explicit human decision are required`,
    `- The action is destructive, irreversible, or affects systems outside the repo`,
    `- The session goal appears already complete`,
    `- No clear next step exists`,
    ``,
    `The instruction must be a concrete, natural human-style request,`,
    `e.g. "Run the tests and fix any failures" or "Commit the safe-write docs as a standalone commit".`,
  ].join("\n")
}

export function parseAutoLoopSupervisorDecision(text: string): SupervisorDecision {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
  try {
    const parsed = JSON.parse(cleaned)
    const validConfidence = parsed?.confidence === "high" || parsed?.confidence === "low" || parsed?.confidence === "pending"
    const hasInstruction = typeof parsed?.instruction === "string" && parsed.instruction.length > 0
    if (validConfidence && (hasInstruction || parsed.confidence === "low")) {
      return {
        confidence: parsed.confidence,
        instruction: typeof parsed.instruction === "string" ? parsed.instruction : "",
        reason: typeof parsed.reason === "string" ? parsed.reason : "",
      }
    }
  } catch {
    // fallthrough
  }
  return { confidence: "low", instruction: "", reason: "supervisor output was not valid JSON" }
}
