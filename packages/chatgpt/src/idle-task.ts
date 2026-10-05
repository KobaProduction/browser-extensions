export interface ScheduledIdleTask {
  cancel(): void
}

export function scheduleIdleTask(callback: () => void, timeout = 400): ScheduledIdleTask {
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(callback, { timeout })
    return { cancel: () => window.cancelIdleCallback(id) }
  }

  const id = window.setTimeout(callback, Math.min(timeout, 50))
  return { cancel: () => window.clearTimeout(id) }
}
