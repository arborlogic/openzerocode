export const DEFAULT_MAX_HOP_DEPTH = 3
export const DEFAULT_MAX_SAME_PAIR_ROUNDTRIPS = 4

let _selfName: string | undefined
let _currentHop = 0
let _fromPeer: string | undefined
let _samePairRoundtrips = 0

let _configuredMaxHopDepth: number | undefined
let _configuredMaxSamePairRoundtrips: number | undefined

function readPositiveIntegerEnv(name: string): number | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

export function configurePeerBudget(options: {
  maxHops?: number
  maxSamePairRoundtrips?: number
}) {
  if (Number.isFinite(options.maxHops) && options.maxHops! > 0) _configuredMaxHopDepth = Math.floor(options.maxHops!)
  if (Number.isFinite(options.maxSamePairRoundtrips) && options.maxSamePairRoundtrips! > 0) {
    _configuredMaxSamePairRoundtrips = Math.floor(options.maxSamePairRoundtrips!)
  }
}

export function getMaxHopDepth(): number {
  return _configuredMaxHopDepth ?? readPositiveIntegerEnv("OPENZEROCODE_MAX_PEER_HOPS") ?? DEFAULT_MAX_HOP_DEPTH
}

export function getMaxSamePairRoundtrips(): number {
  return _configuredMaxSamePairRoundtrips ??
    readPositiveIntegerEnv("OPENZEROCODE_MAX_SAME_PAIR_ROUNDTRIPS") ??
    DEFAULT_MAX_SAME_PAIR_ROUNDTRIPS
}

export function setPeerContext(
  selfName: string | undefined,
  hop: number,
  fromPeer?: string,
  samePairRoundtrips = 0,
) {
  _selfName = selfName
  _currentHop = hop
  _fromPeer = fromPeer
  _samePairRoundtrips = samePairRoundtrips
}

export function getPeerContext(): {
  selfName: string | undefined
  currentHop: number
  fromPeer: string | undefined
  samePairRoundtrips: number
} {
  return {
    selfName: _selfName,
    currentHop: _currentHop,
    fromPeer: _fromPeer,
    samePairRoundtrips: _samePairRoundtrips,
  }
}
