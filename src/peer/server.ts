export type PeerEnqueueFn = (
  text: string,
  fromPeer: string,
  hop: number,
  options?: { samePairRoundtrips?: number; oneWay?: boolean; remainingPeerCalls?: number },
) => void

export async function startPeerServer(
  token: string,
  enqueue: PeerEnqueueFn,
): Promise<{ port: number; stop: () => void }> {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    fetch(req) {
      const url = new URL(req.url)

      if (req.method === "GET" && url.pathname === "/health") {
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        })
      }

      if (req.method === "POST" && url.pathname === "/prompt") {
        const auth = req.headers.get("x-peer-token")
        if (auth !== token) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          })
        }

        return req.json().then((body: unknown) => {
          const b = body as {
            text?: string
            from?: string
            hop?: number
            samePairRoundtrips?: number
            oneWay?: boolean
            remainingPeerCalls?: number
          } | null
          if (!b?.text) {
            return new Response(JSON.stringify({ error: "text required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            })
          }
          enqueue(b.text, b.from ?? "unknown", b.hop ?? 0, {
            samePairRoundtrips: b.samePairRoundtrips,
            oneWay: b.oneWay,
            remainingPeerCalls: b.remainingPeerCalls,
          })
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "Content-Type": "application/json" },
          })
        }).catch(() => new Response(JSON.stringify({ error: "bad request" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }))
      }

      return new Response("Not found", { status: 404 })
    },
  })

  return { port: server.port ?? 0, stop: () => server.stop() }
}
