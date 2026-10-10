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
