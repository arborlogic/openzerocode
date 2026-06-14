import { Effect, Schema } from "effect"
import { Def, Result } from "./types"
import { findPeer, listLivePeers } from "../peer/registry"
import { getPeerContext, MAX_HOP_DEPTH } from "../peer/context"

const Parameters = Schema.Struct({
  name: Schema.String.pipe(
    Schema.annotate({ description: "The name of the peer to send the message to" }),
  ),
  message: Schema.String.pipe(
    Schema.annotate({ description: "The message or request to send to the peer" }),
  ),
})

type Args = { name: string; message: string }

export const CallPeerTool = Effect.gen(function* () {
  const decode = Schema.decodeUnknownEffect(Parameters)

  return new Def({
    id: "call_peer",
    description:
      "Send a message or request to another named openzerocode peer process working on a different project. " +
      "Use this when you need the other AI agent to take action or when you want to share results. " +
      "Only works when this process was started with --name. " +
      `Calls are limited to ${MAX_HOP_DEPTH} hops to prevent infinite loops.`,
    parameters: Parameters,
    execute: (raw, ctx) =>
      Effect.gen(function* () {
        const args = yield* decode(raw) as Effect.Effect<Args>
        const { selfName, currentHop } = getPeerContext()

        if (!selfName) {
          return new Result({
            title: "call_peer failed",
            output: "Not in peer mode. Start openzerocode with --name to enable peer calls.",
          })
        }

        if (currentHop + 1 > MAX_HOP_DEPTH) {
          return new Result({
            title: "call_peer failed",
            output: `Hop limit reached (max ${MAX_HOP_DEPTH}). Cannot make further peer calls in this chain.`,
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
          patterns: [`→ ${args.name}: ${args.message.length > 120 ? args.message.slice(0, 120) + "…" : args.message}`],
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
                hop: currentHop + 1,
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
            title: `Called ${args.name}`,
            output: `Message queued in ${args.name}. The peer will process it in turn.`,
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
