/** VK-only pathname contract. Never infer the selected conversation from archive files. */
export function conversationPeerFromPath(pathname: string): number | null {
  const match = /^\/im\/convo\/([1-9]\d*)(?:\/|$)/.exec(pathname)
  if (!match) return null
  const id = Number(match[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function archiveContextBlock(archivePeerId: number, pagePeerId: number | null): string | null {
  if (pagePeerId === null) return 'Открой нужную переписку VK перед экспортом.'
  if (archivePeerId !== pagePeerId)
    return 'Открыта другая переписка VK. Для неё выбери соответствующую папку архива.'
  return null
}

/** Accept verified numeric legacy query routes only in the VK messenger itself. */
export function conversationPeerFromLocation(
  location: Pick<Location, 'pathname' | 'search'>,
): number | null {
  const fromPath = conversationPeerFromPath(location.pathname)
  if (fromPath !== null) return fromPath
  if (!/^\/im\/?$/.test(location.pathname)) return null
  const raw = new URLSearchParams(location.search).get('sel')
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null
  const peerId = Number(raw)
  return Number.isSafeInteger(peerId) && peerId > 0 ? peerId : null
}
