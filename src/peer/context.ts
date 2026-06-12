export const MAX_HOP_DEPTH = 3

let _selfName: string | undefined
let _currentHop = 0

export function setPeerContext(selfName: string | undefined, hop: number) {
  _selfName = selfName
  _currentHop = hop
}

export function getPeerContext(): { selfName: string | undefined; currentHop: number } {
  return { selfName: _selfName, currentHop: _currentHop }
}
