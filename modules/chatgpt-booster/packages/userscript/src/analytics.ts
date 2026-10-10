import { instanceKey } from '@kobaproduction/browser-core'
import {
  applyTransportCounterEvent,
  EMPTY_TRANSPORT_COUNTERS,
  type PersistentDiagnosticsAdapter,
  type TransportCounterEvent,
  type TransportCounters,
} from '@chatgpt-booster/core'

const STORAGE_KEY = instanceKey('chatgpt-booster:analytics-transport-lifetime', 'chatgpt-booster:prod')
const EVENT_NAME = instanceKey('chatgpt-booster:analytics-changed', 'chatgpt-booster:prod')
const FLUSH_INTERVAL_MS = 5_000
const PUBLISH_INTERVAL_MS = 500

function readStored(): TransportCounters {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return {
      ...EMPTY_TRANSPORT_COUNTERS,
      ...(raw ? (JSON.parse(raw) as Partial<TransportCounters>) : undefined),
    }
  } catch {
    return { ...EMPTY_TRANSPORT_COUNTERS }
  }
}

let counters = readStored()
let dirty = false
let flushTimer: ReturnType<typeof setTimeout> | undefined
let publishTimer: ReturnType<typeof setTimeout> | undefined

function publishNow() {
  if (publishTimer) {
    clearTimeout(publishTimer)
    publishTimer = undefined
  }
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { ...counters } }))
}

function schedulePublish() {
  if (publishTimer) return
  publishTimer = setTimeout(publishNow, PUBLISH_INTERVAL_MS)
}

function flushNow() {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = undefined
  }
  if (!dirty) return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(counters))
  dirty = false
}

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(flushNow, FLUSH_INTERVAL_MS)
}

function recordInMemory(event: TransportCounterEvent) {
  counters = applyTransportCounterEvent(counters, event)
  dirty = true
  schedulePublish()
  scheduleFlush()
}

window.addEventListener('pagehide', flushNow)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushNow()
})

export const userscriptAnalytics: PersistentDiagnosticsAdapter = {
  async getLifetimeTransportCounters() {
    return { ...counters }
  },

  async recordTransport(event) {
    recordInMemory(event)
  },

  async recordTransportBatch(events) {
    for (const event of events) counters = applyTransportCounterEvent(counters, event)
    if (!events.length) return
    dirty = true
    schedulePublish()
    scheduleFlush()
  },

  subscribeLifetimeTransport(listener) {
    const onChanged = (event: Event) => {
      listener((event as CustomEvent<TransportCounters>).detail ?? { ...counters })
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return
      counters = readStored()
      listener({ ...counters })
    }
    window.addEventListener(EVENT_NAME, onChanged)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(EVENT_NAME, onChanged)
      window.removeEventListener('storage', onStorage)
    }
  },
}
