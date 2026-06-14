const PEER_PREFIX = "\x01peer:"
const PEER_SEP = "\x01"

export function encodePeerInput(fromPeer: string, hop: number, text: string): string {
  return `${PEER_PREFIX}${fromPeer}:${hop}${PEER_SEP}${text}`
}

export function decodePeerInput(input: string): { text: string; peerOrigin?: string; peerHop?: number } {
  if (!input.startsWith(PEER_PREFIX)) return { text: input }
  const rest = input.slice(PEER_PREFIX.length)
  const sep = rest.indexOf(PEER_SEP)
  if (sep === -1) return { text: input }
  const meta = rest.slice(0, sep)
  const lastColon = meta.lastIndexOf(":")
  const fromPeer = lastColon >= 0 ? meta.slice(0, lastColon) : meta
  const hop = lastColon >= 0 ? parseInt(meta.slice(lastColon + 1), 10) || 0 : 0
  return { text: rest.slice(sep + 1), peerOrigin: fromPeer, peerHop: hop }
}
