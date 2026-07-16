const PEER_PREFIX = "\x01peer:"
const PEER_SEP = "\x01"

export type PeerInputMetadata = {
  fromPeer: string
  hop: number
  samePairRoundtrips?: number
  oneWay?: boolean
}

export function encodePeerInput(
  fromPeer: string,
  hop: number,
  text: string,
  options: { samePairRoundtrips?: number; oneWay?: boolean } = {},
): string {
  const parts = [`from=${encodeURIComponent(fromPeer)}`, `hop=${hop}`]
  if (options.samePairRoundtrips !== undefined) parts.push(`r=${options.samePairRoundtrips}`)
  if (options.oneWay) parts.push("oneWay=1")
  return `${PEER_PREFIX}${parts.join(";")}${PEER_SEP}${text}`
}

function parseLegacyPeerMetadata(meta: string): PeerInputMetadata {
  const lastColon = meta.lastIndexOf(":")
  const fromPeer = lastColon >= 0 ? meta.slice(0, lastColon) : meta
  const hop = lastColon >= 0 ? parseInt(meta.slice(lastColon + 1), 10) || 0 : 0
  return { fromPeer, hop }
}

function parsePeerMetadata(meta: string): PeerInputMetadata {
  if (!meta.includes("=")) return parseLegacyPeerMetadata(meta)

  const values = new Map<string, string>()
  for (const part of meta.split(";")) {
    const eq = part.indexOf("=")
    if (eq <= 0) continue
    values.set(part.slice(0, eq), part.slice(eq + 1))
  }

  const encodedFrom = values.get("from") ?? "unknown"
  let fromPeer = "unknown"
  try {
    fromPeer = decodeURIComponent(encodedFrom)
  } catch {
    fromPeer = encodedFrom
  }

  const hop = parseInt(values.get("hop") ?? "0", 10) || 0
  const samePairRoundtrips = parseInt(values.get("r") ?? "0", 10) || 0
  return {
    fromPeer,
    hop,
    samePairRoundtrips,
    oneWay: values.get("oneWay") === "1",
  }
}

export function decodePeerInput(input: string): {
  text: string
  peerOrigin?: string
  peerHop?: number
  samePairRoundtrips?: number
  oneWay?: boolean
} {
  if (!input.startsWith(PEER_PREFIX)) return { text: input }
  const rest = input.slice(PEER_PREFIX.length)
  const sep = rest.indexOf(PEER_SEP)
  if (sep === -1) return { text: input }
  const meta = rest.slice(0, sep)
  const parsed = parsePeerMetadata(meta)
  const decoded: {
    text: string
    peerOrigin?: string
    peerHop?: number
    samePairRoundtrips?: number
    oneWay?: boolean
  } = {
    text: rest.slice(sep + 1),
    peerOrigin: parsed.fromPeer,
    peerHop: parsed.hop,
  }
  if (parsed.samePairRoundtrips !== undefined) decoded.samePairRoundtrips = parsed.samePairRoundtrips
  if (parsed.oneWay !== undefined) decoded.oneWay = parsed.oneWay
  return decoded
}
