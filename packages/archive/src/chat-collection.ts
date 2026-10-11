/** Provider-neutral lifecycle for collection of one verified conversation.
 * Neither this contract nor its controller knows ChatGPT/VK payloads or storage. */
export interface ChatCollectionSnapshot {
  readonly phase: 'idle' | 'running' | 'completed' | 'cancelled' | 'error'
  readonly processed: number
  readonly total: number | null
  readonly saved: number | null
}
export interface ChatCollectionPort {
  /** by-event: start returns before provider source paging finishes. */
  readonly completion?: 'on-return' | 'by-event'
  /** Provider checks account, conversation, privileges and capture policy. */
  start(): Promise<void>
  stop(): void
  snapshot(): ChatCollectionSnapshot
  subscribe(listener: (snapshot: ChatCollectionSnapshot) => void): () => void
}
export interface ChatCollectionController {
  start(): Promise<void>
  stop(): void
  snapshot(): ChatCollectionSnapshot
  subscribe(listener: (state: ChatCollectionSnapshot) => void): () => void
  dispose(): void
}

/** Single-flight orchestration and status fan-out; cancellation is owned by the provider. */
export function createChatCollectionController(port: ChatCollectionPort): ChatCollectionController {
  let running: Promise<void> | null = null
  let cancelled = false
  let disposed = false
  let state = port.snapshot()
  const listeners = new Set<(state: ChatCollectionSnapshot) => void>()
  const publish = (next: ChatCollectionSnapshot) => {
    if (disposed) return
    state = next
    for (const listener of [...listeners]) listener(state)
  }
  const off = port.subscribe((next) => {
    if (cancelled && (next.phase === 'completed' || next.phase === 'running')) return
    publish(next)
  })
  return {
    snapshot: () => state,
    subscribe(listener) {
      if (disposed) throw Error('Collection controller already disposed')
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start() {
      if (disposed) return Promise.reject(Error('Collection controller disposed'))
      if (running) return running
      if (state.phase === 'running') return Promise.resolve()
      cancelled = false
      publish({ phase: 'running', processed: 0, total: null, saved: null })
      const task = Promise.resolve()
        .then(() => port.start())
        .then(
          () => {
            if (
              !cancelled &&
              (state.phase === 'running' || state.phase === 'idle') &&
              port.completion !== 'by-event'
            )
              publish({ ...state, phase: 'completed' })
          },
          (error: unknown) => {
            if (cancelled) return
            publish({ ...state, phase: 'error' })
            throw error
          },
        )
        .finally(() => {
          if (running === task) running = null
        })
      running = task
      return task
    },
    stop() {
      if (disposed || (!running && state.phase !== 'running')) return
      cancelled = true
      port.stop()
      publish({ ...state, phase: 'cancelled' })
    },
    dispose() {
      if (disposed) return
      const active = Boolean(running) || state.phase === 'running'
      disposed = true
      if (active) port.stop()
      off()
      listeners.clear()
    },
  }
}
