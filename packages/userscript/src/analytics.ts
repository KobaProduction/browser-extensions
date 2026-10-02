import {
  applyTransportCounterEvent,
  EMPTY_TRANSPORT_COUNTERS,
  type PersistentDiagnosticsAdapter,
  type TransportCounters,
} from '@chatgpt-booster/core'

const STORAGE_KEY = 'chatgpt-booster:analytics-transport-lifetime'
const EVENT_NAME = 'chatgpt-booster:analytics-changed'

function read(): TransportCounters {
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

function write(counters: TransportCounters) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(counters))
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: counters }))
}

export const userscriptAnalytics: PersistentDiagnosticsAdapter = {
  async getLifetimeTransportCounters() {
    return read()
  },

  async recordTransport(event) {
    write(applyTransportCounterEvent(read(), event))
  },

  subscribeLifetimeTransport(listener) {
    const onChanged = (event: Event) => {
      listener((event as CustomEvent<TransportCounters>).detail ?? read())
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return
      listener(read())
    }
    window.addEventListener(EVENT_NAME, onChanged)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(EVENT_NAME, onChanged)
      window.removeEventListener('storage', onStorage)
    }
  },
}
