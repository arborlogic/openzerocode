import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import { findPeer, listLivePeers } from "../peer/registry"
import {
  getDeepCollaborationPeerCallBudget,
  getMaxHopDepth,
  getMaxSamePairRoundtrips,
  getPeerContext,
  isDeepCollaborationEnabled,
} from "../peer/context"

const Parameters = Schema.Struct({
  name: Schema.String.pipe(
    Schema.annotate({ description: "The name of the peer to send the message to" }),
  ),
  message: Schema.String.pipe(
    Schema.annotate({ description: "The message or request to send to the peer" }),
  ),
  oneWay: Schema.optional(Schema.Boolean.pipe(
    Schema.annotate({ description: "When true, send a no-reply notification that does not advance the collaboration budget" }),
  )),
  intent: Schema.optional(Schema.Literals([
    "notify",
    "handoff_summary",
    "ask_question",
    "review_plan",
    "critique",
    "brainstorm",
    "delegate_task",
  ]).pipe(
    Schema.annotate({ description: "The collaboration intent for this peer message" }),
  )),
})

type Args = {
  name: string
  message: string
  oneWay?: boolean
  intent?: "notify" | "handoff_summary" | "ask_question" | "review_plan" | "critique" | "brainstorm" | "delegate_task"
}

function isOneWay(args: Args): boolean {
  return args.oneWay === true || args.intent === "notify" || args.intent === "handoff_summary"
}

export const CallPeerTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)

  return new Def({
    id: "call_peer",
    group: "peer",
    description:
      "Send a message or request to another named openzerocode peer process working on a different project. " +
      "Use this when you need the other AI agent to take action or when you want to share results. " +
      "Only works when this process was started with --name. " +
      "By default, peer calls use a shallow 3-hop guard. For sustained collaboration, start peers with " +
      "--deep-collaboration to switch to a bounded total peer-call budget. " +
      "Use oneWay=true or intent notify/handoff_summary for no-reply updates that do not consume the collaboration budget.",
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<Args>
        const { selfName, currentHop, fromPeer, samePairRoundtrips, remainingPeerCalls } = getPeerContext()
        const deepCollaboration = isDeepCollaborationEnabled()
        const maxHops = getMaxHopDepth()
        const maxSamePairRoundtrips = getMaxSamePairRoundtrips()
        const oneWay = isOneWay(args)
        const startingDeepBudget = remainingPeerCalls ?? getDeepCollaborationPeerCallBudget()
        const nextHop = deepCollaboration ? currentHop : oneWay ? currentHop : currentHop + 1
        const nextRemainingPeerCalls = oneWay ? startingDeepBudget : startingDeepBudget - 1
        const nextSamePairRoundtrips = fromPeer === args.name ? samePairRoundtrips + 1 : 0

        if (!selfName) {
          return new Result({
            title: "call_peer failed",
            output: "Not in peer mode. Start openzerocode with --name to enable peer calls.",
          })
        }

        if (!oneWay && deepCollaboration && nextRemainingPeerCalls < 0) {
          return new Result({
            title: "call_peer failed",
            output: `Deep collaboration budget exhausted (max ${getDeepCollaborationPeerCallBudget()} peer calls for this chain). Stop the loop, summarize the current state for the user, or restart peers with --deep-collaboration-peer-calls / OPENZEROCODE_DEEP_COLLABORATION_PEER_CALLS if the user explicitly approved a larger bounded collaboration.`,
          })
        }

        if (!oneWay && !deepCollaboration && nextHop > maxHops) {
          return new Result({
            title: "call_peer failed",
            output: `Hop limit reached (max ${maxHops}). Cannot make further peer calls in this chain. Use oneWay=true for no-reply summaries, or restart with --deep-collaboration for a bounded deep collaboration budget.`,
          })
        }

        if (!oneWay && fromPeer === args.name && nextSamePairRoundtrips > maxSamePairRoundtrips) {
          return new Result({
            title: "call_peer failed",
            output: `Same-pair roundtrip limit reached for ${selfName}<->${args.name} (max ${maxSamePairRoundtrips}). Stop the loop, ask the user for approval, or provide a clearly new question before continuing.`,
          })
        }

        const peer = findPeer(args.name)
        if (!peer) {
          const online = listLivePeers().map((p) => p.name)
          const hint = online.length > 0 ? ` Online peers: ${online.join(", ")}` : " No peers are currently online."
          return new Result({
            title: "call_peer failed",
            output: `No peer named "${args.name}" is online.${hint}`,
          })
        }

        // Permission check — goes through the TUI's existing approval mechanism
        yield* ctx.ask({
          permission: "call_peer",
          patterns: [`→ ${args.name}${oneWay ? " (one-way)" : ""}: ${args.message.length > 120 ? args.message.slice(0, 120) + "…" : args.message}`],
        })

        try {
          const res = yield* Effect.promise(() =>
            fetch(`http://127.0.0.1:${peer.port}/prompt`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-peer-token": peer.token,
              },
              body: JSON.stringify({
                text: args.message,
                from: selfName,
                hop: nextHop,
                samePairRoundtrips: nextSamePairRoundtrips,
                remainingPeerCalls: deepCollaboration ? nextRemainingPeerCalls : undefined,
                oneWay,
              }),
            }),
          )

          if (!res.ok) {
            const body = (yield* Effect.promise(() => res.json().catch(() => ({})))) as { error?: string }
            return new Result({
              title: "call_peer failed",
              output: body.error ?? `HTTP ${res.status}`,
            })
          }

          return new Result({
            title: oneWay ? `Sent one-way message to ${args.name}` : `Called ${args.name}`,
            output: oneWay
              ? `One-way message queued in ${args.name}. No callback is expected.`
              : deepCollaboration
                ? `Message queued in ${args.name}. Deep collaboration budget remaining after this call: ${nextRemainingPeerCalls}.`
                : `Message queued in ${args.name}. The peer will process it in turn.`,
          })
        } catch (err) {
          return new Result({
            title: "call_peer failed",
            output: err instanceof Error ? err.message : String(err),
          })
        }
      }),
  })
})
