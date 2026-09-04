import type { Message, Part } from "../provider/types"
import { contentToText } from "../provider/content"
import { estimateMessageRequestTokens, estimateMessageTokens, estimateTokens } from "../provider/models"

export const COMPACT_SUMMARY_PREFIX = "[Session Summary]"

/** Maximum completion size reserved for a generated session summary. */
export const COMPACTION_SUMMARY_TOKEN_BUDGET = 1_600

/** Prompt and message-serialization room reserved during the summary request. */
export const COMPACTION_REQUEST_OVERHEAD_TOKEN_BUDGET = 1_200

/**
 * Keep summary generation comfortably below gateway/provider timeouts. Model
 * context windows can be hundreds of thousands of tokens, but using nearly
 * the whole window for a synchronous compaction request is unnecessarily slow
 * and leaves too little room for tokenizer differences.
 */
export const COMPACTION_TRANSCRIPT_TOKEN_CAP = 24_000

/** A timeout retry must be materially smaller, not merely 60% of a huge window. */
export const COMPACTION_RETRY_TOKEN_CAP = 8_000

function describeImageUrl(url: string): string {
  const dataUrl = url.match(/^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/i)
  if (!dataUrl) return "image attachment (external URL)"

  const bytes = Math.floor(dataUrl[2]!.length * 3 / 4)
  return `image attachment (${dataUrl[1]!.toLowerCase()}, ${(bytes / 1024).toFixed(bytes >= 10_240 ? 0 : 1)} KiB)`
}

function imageAttachmentDescriptions(msg: Message): string[] {
  const descriptions = new Map<string, string>()
  if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.type !== "image_url") continue
      const dataUrl = part.image_url.url.match(/^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/]+={0,2})$/i)
      // The same attachment is commonly mirrored in `content` and `parts`.
      // Key data URLs by their payload, and external images by their exact
      // reference, instead of keying by the lossy type/size description.
      const identity = dataUrl ? `base64:${dataUrl[1]}` : `url:${part.image_url.url}`
      if (!descriptions.has(identity)) descriptions.set(identity, describeImageUrl(part.image_url.url))
    }
  }
  for (const part of msg.parts ?? []) {
    if (part.type === "image") {
      const bytes = Math.floor(part.base64.length * 3 / 4)
      const identity = `base64:${part.base64}`
      if (!descriptions.has(identity)) {
        descriptions.set(identity, `image attachment (${part.mimeType}, ${(bytes / 1024).toFixed(bytes >= 10_240 ? 0 : 1)} KiB)`)
      }
    }
  }
  return [...descriptions.values()]
}

function partToText(part: Part): string {
  switch (part.type) {
    case "text":
      return part.text
    case "reasoning":
      return `[thinking]\n${part.text}`
    case "tool-call":
      return `[tool-call:${part.tool}]\n${part.input}`
    case "tool-result":
      return `[tool-result:${part.tool ?? part.id ?? "unknown"}]\n${part.output}`
    default:
      return ""
  }
}

function messageBody(msg: Message): string {
  const imageDescriptions = imageAttachmentDescriptions(msg).map((description) => `[${description}]`)
  if (msg.parts?.length) {
    return [...msg.parts.map(partToText).filter(Boolean), ...imageDescriptions].join("\n\n")
  }
  return [msg.reasoning_content, contentToText(msg.content), ...imageDescriptions].filter(Boolean).join("\n\n")
}

function messageToTranscript(msg: Message): string {
  const role = msg.role.toUpperCase()
  return `${role}:\n${messageBody(msg)}`.trim()
}

export function isCompactSummaryMessage(msg: Message): boolean {
  return msg.role === "system" && contentToText(msg.content).startsWith(COMPACT_SUMMARY_PREFIX)
}

export function stripCompactSummaryMessages(messages: Message[]): Message[] {
  return messages.filter((msg) => !isCompactSummaryMessage(msg))
}

/** Default context utilization at which automatic session compaction begins. */
export const CONTEXT_WARNING_THRESHOLD = 0.6

/**
 * Estimate the prompt-sized session context. The current compacted summary is
 * stored separately from the visible message history, but is still sent as a
 * system message on every request, so callers must include it here.
 */
export function estimateContextTokens(
  messages: Message[],
  extraInput: string = "",
  compactionSummary: string = "",
): number {
  const clean = stripCompactSummaryMessages(messages)
  const summaryMessages: Message[] = compactionSummary
    ? [{ role: "system", content: `[Compaction Summary]\n${compactionSummary}` }]
    : []
  return estimateMessageTokens([...summaryMessages, ...clean]) + estimateTokens(extraInput)
}

/**
 * Estimate what the provider receives, including a conservative allowance for
 * vision attachments. Use this for admission/compaction decisions; retaining
 * a group of images can overflow a request even though their base64 payload is
 * intentionally excluded from the human-readable context meter.
 */
export function estimateRequestContextTokens(
  messages: Message[],
  extraInput: string = "",
  compactionSummary: string = "",
): number {
  const clean = stripCompactSummaryMessages(messages)
  const summaryMessages: Message[] = compactionSummary
    ? [{ role: "system", content: `[Compaction Summary]\n${compactionSummary}` }]
    : []
  return estimateMessageRequestTokens([...summaryMessages, ...clean]) + estimateTokens(extraInput)
}

export function shouldAutoCompactContext(
  messages: Message[],
  extraInput: string,
  contextLimit: number,
  threshold: number = CONTEXT_WARNING_THRESHOLD,
  compactionSummary: string = "",
): boolean {
  return estimateRequestContextTokens(messages, extraInput, compactionSummary) > contextLimit * threshold
}

export function selectCompactionTail(messages: Message[], contextLimit: number): { head: Message[]; tail: Message[] } {
  const clean = stripCompactSummaryMessages(messages)
  // Normally a short exchange is not worth compacting. An oversized tool
  // result is an exception: retaining even one such message can leave the
  // session over its context limit after a successful compaction.
  if (clean.length <= 6 && estimateRequestContextTokens(clean) <= contextLimit * CONTEXT_WARNING_THRESHOLD) {
    return { head: [], tail: clean }
  }

  // Do not force a minimum number of recent messages. A few large tool
  // outputs can exceed the entire context window by themselves. The summary
  // plus the retained tail must each independently fit within their budget.
  const tailBudget = Math.max(0, Math.min(12_000, Math.floor(contextLimit * 0.2) - COMPACTION_SUMMARY_TOKEN_BUDGET))
  let used = 0
  let tailStart = clean.length

  for (let i = clean.length - 1; i >= 0; i--) {
    // Request budgeting includes a bounded vision-token allowance per image.
    // The readable compaction transcript and UI text-context estimate omit
    // image payloads, but retaining too many images can still overflow a
    // provider context window.
    const nextCost = estimateMessageRequestTokens([clean[i]!])
    if (used + nextCost > tailBudget) break
    used += nextCost
    tailStart = i
  }

  // Avoid splitting in the middle of a tool call cycle.
  // If the tail starts with orphaned tool messages (their corresponding
  // assistant is in the head), advance past them into the head.
  while (tailStart < clean.length && clean[tailStart]?.role === "tool") {
    tailStart++
  }

  return {
    head: clean.slice(0, tailStart),
    tail: clean.slice(tailStart),
  }
}

export function buildCompactionTranscript(messages: Message[]): string {
  return messages.map(messageToTranscript).filter(Boolean).join("\n\n---\n\n")
}

/**
 * Maximum source-history size for the separate compaction request. Keeping
 * this independent from tail selection guarantees that the prompt, summary
 * completion, and provider serialization all fit within the model window.
 */
export function compactionTranscriptTokenBudget(contextLimit: number): number {
  return Math.min(
    COMPACTION_TRANSCRIPT_TOKEN_CAP,
    Math.max(0, contextLimit - COMPACTION_SUMMARY_TOKEN_BUDGET - COMPACTION_REQUEST_OVERHEAD_TOKEN_BUDGET),
  )
}

/**
 * Retry a failed summary with a substantially smaller source prompt. Provider
 * tokenizers can differ from our local estimator, so using the same transcript
 * again tends to repeat context-length failures.
 */
export function compactionRetryTokenBudget(contextLimit: number): number {
  return Math.min(
    COMPACTION_RETRY_TOKEN_CAP,
    Math.floor(compactionTranscriptTokenBudget(contextLimit) * 0.6),
  )
}

/** Keep the newest source history when a compaction transcript is oversized. */
export function truncateCompactionTranscript(transcript: string, tokenBudget: number): string {
  if (estimateTokens(transcript) <= tokenBudget) return transcript
  const marker = "[Earlier compaction history omitted to fit the context budget]\n\n"
  const available = tokenBudget - estimateTokens(marker)
  if (available <= 0) return marker.trim()

  let low = 0
  let high = transcript.length
  while (low < high) {
    const length = Math.ceil((low + high) / 2)
    if (estimateTokens(transcript.slice(-length)) <= available) low = length
    else high = length - 1
  }
  return marker + transcript.slice(-low)
}

function truncateCompactionTranscriptToFit(
  transcript: string,
  tokenBudget: number,
  fits: (candidate: string) => boolean,
): string {
  const candidateFits = (candidate: string) =>
    estimateTokens(candidate) <= tokenBudget && fits(candidate)
  const bounded = truncateCompactionTranscript(transcript, tokenBudget)
  if (candidateFits(bounded)) return bounded

  const marker = "[Earlier compaction history omitted to fit the context budget]\n\n"
  if (!candidateFits(marker.trim())) return ""

  let low = 0
  let high = transcript.length
  while (low < high) {
    const length = Math.ceil((low + high) / 2)
    if (candidateFits(marker + transcript.slice(-length))) low = length
    else high = length - 1
  }
  return low > 0 ? marker + transcript.slice(-low) : marker.trim()
}

/**
 * Build a bounded summary source while giving the prior compaction summary
 * precedence over newly selected message history. On repeated compaction, the
 * prior summary represents older context that no longer exists in messages;
 * truncating a combined transcript from the front would silently discard it.
 */
export function buildPrioritizedCompactionTranscript(
  previousSummary: string | undefined,
  messages: Message[],
  tokenBudget: number,
  fits: (transcript: string) => boolean = () => true,
): string {
  const history = buildCompactionTranscript(messages)
  if (!previousSummary) return truncateCompactionTranscriptToFit(history, tokenBudget, fits)

  let previous = `[PREVIOUS COMPACTION SUMMARY]\n${previousSummary}`
  // Generated summaries are bounded, but imported or legacy sessions may
  // contain an arbitrarily large summary. Keep as much of its newest content
  // as possible rather than making every future compaction request fail. Apply
  // both limits: `fits` protects the full serialized provider request, while
  // `tokenBudget` keeps normal and retry attempts at their intended sizes.
  if (estimateTokens(previous) > tokenBudget || !fits(previous)) {
    previous = truncateCompactionTranscriptToFit(previous, tokenBudget, fits)
  }
  if (!previous) return ""
  if (!history) return previous

  const separator = "\n\n---\n\n"
  // Do not truncate `previous`: it is the only representation of context
  // compacted in earlier passes. Reserve its complete cost first, then trim
  // only the newly selected source history.
  const historyBudget = tokenBudget - estimateTokens(previous) - estimateTokens(separator)
  if (historyBudget <= 0) return previous

  const withHistory = (candidate: string) => fits(previous + separator + candidate)
  const boundedHistory = truncateCompactionTranscriptToFit(history, historyBudget, withHistory)
  return boundedHistory ? previous + separator + boundedHistory : previous
}

/**
 * Count all original messages represented by a replacement summary. Repeated
 * compaction summarizes both a previous summary and a new slice of history.
 */
export function cumulativeCompactionSourceCount(
  newlySummarizedCount: number,
  previousSourceCount: number = 0,
): number {
  return previousSourceCount + newlySummarizedCount
}

export function createCompactSummaryMessage(summary: string): Message {
  return {
    role: "system",
    content: `${COMPACT_SUMMARY_PREFIX}\n${summary.trim()}`,
  }
}
