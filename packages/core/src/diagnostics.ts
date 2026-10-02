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

export interface PersistentDiagnosticsAdapter {
  getLifetimeTransportCounters(): Promise<TransportCounters>
  recordTransport(event: TransportCounterEvent): Promise<void>
  subscribeLifetimeTransport(listener: (counters: TransportCounters) => void): () => void
}

export interface TelemetryControlAdapter {
  test(): Promise<void>
}

export interface TransportCounterEvent {
  direction: 'outbound' | 'inbound'
  phase: 'request' | 'response' | 'message' | 'open' | 'close' | 'error'
  timestamp: number
}

export function applyTransportCounterEvent(
  current: TransportCounters,
  event: TransportCounterEvent,
): TransportCounters {
  const next = { ...current, lastEventAt: event.timestamp }
  if (event.phase === 'error') next.errors += 1
  if (event.phase === 'request') next.requestsSent += 1
  if (event.phase === 'response') next.responsesReceived += 1
  if (event.phase === 'message' && event.direction === 'outbound') next.messagesSent += 1
  if (event.phase === 'message' && event.direction === 'inbound') next.messagesReceived += 1
  return next
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
      counters = applyTransportCounterEvent(counters, event)
      publish()
    },
  }
}
