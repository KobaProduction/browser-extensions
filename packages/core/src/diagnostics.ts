export interface TransportCounters {
  requestsSent: number
  responsesReceived: number
  messagesSent: number
  messagesReceived: number
  errors: number
  lastEventAt: number | null
}

export const EMPTY_TRANSPORT_COUNTERS: TransportCounters = {
  requestsSent: 0,
  responsesReceived: 0,
  messagesSent: 0,
  messagesReceived: 0,
  errors: 0,
  lastEventAt: null,
}

export interface DiagnosticsAdapter {
  getTransportCounters(): TransportCounters
  subscribeTransport(listener: (counters: TransportCounters) => void): () => void
  resetTransport(): void
}

export interface TransportCounterEvent {
  direction: 'outbound' | 'inbound'
  phase: 'request' | 'response' | 'message' | 'open' | 'close' | 'error'
  timestamp: number
}

export function createDiagnosticsStore(): DiagnosticsAdapter & {
  recordTransport(event: TransportCounterEvent): void
} {
  let counters = { ...EMPTY_TRANSPORT_COUNTERS }
  const listeners = new Set<(value: TransportCounters) => void>()

  const publish = () => {
    const snapshot = { ...counters }
    for (const listener of listeners) listener(snapshot)
  }

  return {
    getTransportCounters() {
      return { ...counters }
    },
    subscribeTransport(listener) {
      listeners.add(listener)
      listener({ ...counters })
      return () => listeners.delete(listener)
    },
    resetTransport() {
      counters = { ...EMPTY_TRANSPORT_COUNTERS }
      publish()
    },
    recordTransport(event) {
      counters.lastEventAt = event.timestamp
      if (event.phase === 'error') counters.errors += 1
      if (event.phase === 'request') counters.requestsSent += 1
      if (event.phase === 'response') counters.responsesReceived += 1
      if (event.phase === 'message' && event.direction === 'outbound') counters.messagesSent += 1
      if (event.phase === 'message' && event.direction === 'inbound') counters.messagesReceived += 1
      publish()
    },
  }
}
