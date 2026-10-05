export interface ScheduledIdleTask {
  cancel(): void
}

export function scheduleIdleTask(
  callback: () => void,
  timeout = 400,
  delay = 0,
): ScheduledIdleTask {
  let timer: number | undefined
  let idle: number | undefined
  let cancelled = false

  const run = () => {
    timer = undefined
    if (cancelled) return
    if (typeof window.requestIdleCallback === 'function') {
      idle = window.requestIdleCallback(
        () => {
          idle = undefined
          if (!cancelled) callback()
        },
        { timeout },
      )
      return
    }
    timer = window.setTimeout(
      () => {
        timer = undefined
        if (!cancelled) callback()
      },
      Math.min(timeout, 50),
    )
  }

  if (delay > 0) timer = window.setTimeout(run, delay)
  else run()

  return {
    cancel() {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
      if (idle !== undefined && typeof window.cancelIdleCallback === 'function')
        window.cancelIdleCallback(idle)
      timer = undefined
      idle = undefined
    },
  }
}
