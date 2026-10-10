import {
  EMPTY_TRANSPORT_COUNTERS,
  type PersistentDiagnosticsAdapter,
  type TransportCounters,
} from '@chatgpt-booster/core'

const ANALYTICS_KEY = 'analyticsTransportLifetime'

type AnalyticsResponse = {
  ok?: boolean
  counters?: TransportCounters
  error?: string
}

export const chromeAnalytics: PersistentDiagnosticsAdapter = {
  async getLifetimeTransportCounters() {
    const response = (await chrome.runtime.sendMessage({
      type: 'chatgpt-booster:analytics-get',
    })) as AnalyticsResponse
    if (!response?.ok || !response.counters) {
      return { ...EMPTY_TRANSPORT_COUNTERS }
    }
    return response.counters
  },

  async recordTransport(event) {
    const response = (await chrome.runtime.sendMessage({
      type: 'chatgpt-booster:analytics-record',
      event,
    })) as AnalyticsResponse
    if (!response?.ok) throw new Error(response?.error ?? 'Analytics persistence failed')
  },

  async recordTransportBatch(events) {
    if (!events.length) return
    const response = (await chrome.runtime.sendMessage({
      type: 'chatgpt-booster:analytics-record-batch',
      events,
    })) as AnalyticsResponse
    if (!response?.ok) throw new Error(response?.error ?? 'Analytics persistence failed')
  },

  subscribeLifetimeTransport(listener) {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== 'local' || !changes[ANALYTICS_KEY]) return
      listener({
        ...EMPTY_TRANSPORT_COUNTERS,
        ...(changes[ANALYTICS_KEY].newValue as Partial<TransportCounters> | undefined),
      })
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  },
}
