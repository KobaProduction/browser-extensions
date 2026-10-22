/** Refresh on the next microtask after commit, never after a debounce timer.
 * Async reads are serialized; changes during a read trigger one subsequent read. */
export function createArchiveRefreshQueue(refresh: () => void | Promise<void>) {
  let scheduled = false,
    running = false,
    dirty = false,
    stopped = false
  const request = () => {
    if (stopped) return
    dirty = true
    if (scheduled || running) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (stopped) return
      dirty = false
      running = true
      void Promise.resolve()
        .then(refresh)
        .catch(() => undefined)
        .finally(() => {
          running = false
          if (dirty) request()
        })
    })
  }
  return {
    request,
    stop() {
      stopped = true
      dirty = false
    },
  }
}
