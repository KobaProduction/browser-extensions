/** Commit invalidation only. No records, conversation IDs or account data cross tabs. */
export interface ArchiveChangeFeed {
  revision(): number
  publish(): void
  subscribe(listener: () => void): () => void
  close(): void
}
export function createArchiveChangeFeed(namespace: string): ArchiveChangeFeed {
  if (!/^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*){2,5}$/.test(namespace))
    throw Error('Archive events require an explicit product/channel namespace')
  const listeners = new Set<() => void>()
  let revision = 0,
    closed = false
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(namespace) : null
  const changed = () => {
    revision++
    for (const listener of listeners)
      try {
        listener()
      } catch {}
  }
  if (channel)
    channel.onmessage = (event) => {
      if (!closed && event.data?.type === 'archive-committed' && Object.keys(event.data).length === 1)
        changed()
    }
  return {
    revision: () => revision,
    publish() {
      if (!closed) {
        changed()
        channel?.postMessage({ type: 'archive-committed' })
      }
    },
    subscribe(listener) {
      if (!closed) listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      closed = true
      listeners.clear()
      channel?.close()
    },
  }
}
