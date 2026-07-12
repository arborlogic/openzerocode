export const DEFAULT_MAX_HOP_DEPTH = 3
export const DEFAULT_MAX_SAME_PAIR_ROUNDTRIPS = 4
export const DEFAULT_DEEP_COLLABORATION_PEER_CALLS = 12

let _selfName: string | undefined
let _currentHop = 0
let _fromPeer: string | undefined
let _samePairRoundtrips = 0
let _remainingPeerCalls: number | undefined

let _configuredMaxHopDepth: number | undefined
let _configuredMaxSamePairRoundtrips: number | undefined
let _configuredDeepCollaboration: boolean | undefined
let _configuredDeepCollaborationPeerCalls: number | undefined

function readPositiveIntegerEnv(name: string): number | undefined {
  const raw = process.env[name]
  if (!raw) return undefined
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function readBooleanEnv(name: string): boolean | undefined {
  const raw = process.env[name]?.trim().toLowerCase()
  if (!raw) return undefined
  if (["1", "true", "yes", "on"].includes(raw)) return true
  if (["0", "false", "no", "off"].includes(raw)) return false
  return undefined
}

export function configurePeerBudget(options: {
  maxHops?: number
  maxSamePairRoundtrips?: number
  deepCollaboration?: boolean
  deepCollaborationPeerCalls?: number
}) {
  if (Number.isFinite(options.maxHops) && options.maxHops! > 0) _configuredMaxHopDepth = Math.floor(options.maxHops!)
  if (Number.isFinite(options.maxSamePairRoundtrips) && options.maxSamePairRoundtrips! > 0) {
    _configuredMaxSamePairRoundtrips = Math.floor(options.maxSamePairRoundtrips!)
  }
  if (typeof options.deepCollaboration === "boolean") _configuredDeepCollaboration = options.deepCollaboration
  if (Number.isFinite(options.deepCollaborationPeerCalls) && options.deepCollaborationPeerCalls! > 0) {
    _configuredDeepCollaborationPeerCalls = Math.floor(options.deepCollaborationPeerCalls!)
  }
}

export function isDeepCollaborationEnabled(): boolean {
  return _configuredDeepCollaboration ?? readBooleanEnv("OPENZEROCODE_DEEP_COLLABORATION") ?? false
}

export function getDeepCollaborationPeerCallBudget(): number {
  return _configuredDeepCollaborationPeerCalls ??
    readPositiveIntegerEnv("OPENZEROCODE_DEEP_COLLABORATION_PEER_CALLS") ??
    DEFAULT_DEEP_COLLABORATION_PEER_CALLS
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
  remainingPeerCalls?: number,
) {
  _selfName = selfName
  _currentHop = hop
  _fromPeer = fromPeer
  _samePairRoundtrips = samePairRoundtrips
  _remainingPeerCalls = remainingPeerCalls
}

export function getPeerContext(): {
  selfName: string | undefined
  currentHop: number
  fromPeer: string | undefined
  samePairRoundtrips: number
  remainingPeerCalls: number | undefined
} {
  return {
    selfName: _selfName,
    currentHop: _currentHop,
    fromPeer: _fromPeer,
    samePairRoundtrips: _samePairRoundtrips,
    remainingPeerCalls: _remainingPeerCalls,
  }
}
