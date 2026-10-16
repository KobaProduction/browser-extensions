/** Coalesce commit bursts without postponing the first refresh indefinitely.
 * Changes during an async read schedule exactly one subsequent refresh. */
export function createArchiveRefreshQueue(refresh: () => void | Promise<void>, delay: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false,
    dirty = false,
    stopped = false
  const request = () => {
    if (stopped) return
    dirty = true
    if (timer || running) return
    timer = setTimeout(() => {
      timer = undefined
      dirty = false
      running = true
      void Promise.resolve()
        .then(refresh)
        .catch(() => undefined)
        .finally(() => {
          running = false
          if (dirty) request()
        })
    }, delay)
  }
  return {
    request,
    stop() {
      stopped = true
      dirty = false
      if (timer) clearTimeout(timer)
    },
  }
}
