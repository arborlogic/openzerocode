import type { Message, Part } from "../provider/types"
import { contentToText } from "../provider/content"
import { estimateMessageTokens, estimateTokens } from "../provider/models"

export const COMPACT_SUMMARY_PREFIX = "[Session Summary]"

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
  if (msg.parts?.length) {
    return msg.parts.map(partToText).filter(Boolean).join("\n\n")
  }
  return [msg.reasoning_content, contentToText(msg.content)].filter(Boolean).join("\n\n")
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

export const CONTEXT_WARNING_THRESHOLD = 0.8

export function estimateContextTokens(messages: Message[], extraInput: string = ""): number {
  const clean = stripCompactSummaryMessages(messages)
  return estimateMessageTokens(clean) + estimateTokens(extraInput)
}

export function shouldAutoCompactContext(messages: Message[], extraInput: string, contextLimit: number): boolean {
  return estimateContextTokens(messages, extraInput) > contextLimit * CONTEXT_WARNING_THRESHOLD
}

export function selectCompactionTail(messages: Message[], contextLimit: number): { head: Message[]; tail: Message[] } {
  const clean = stripCompactSummaryMessages(messages)
  if (clean.length <= 6) return { head: [], tail: clean }

  const tailBudget = Math.max(1200, Math.min(12_000, Math.floor(contextLimit * 0.2)))
  const minTailMessages = Math.min(6, clean.length)
  let used = 0
  let tailStart = clean.length

  for (let i = clean.length - 1; i >= 0; i--) {
    const nextCost = estimateTokens(messageToTranscript(clean[i]!))
    const mustKeep = clean.length - i <= minTailMessages
    if (!mustKeep && used + nextCost > tailBudget) break
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

export function createCompactSummaryMessage(summary: string): Message {
  return {
    role: "system",
    content: `${COMPACT_SUMMARY_PREFIX}\n${summary.trim()}`,
  }
}
