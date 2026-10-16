import type { RemoteSessionConfig } from './automation'

/** Transport-neutral presentation contract; implementations belong to adapters. */
export interface RemoteSessionStatus {
  readonly eventMode: 'normalized' | 'raw'
  readonly state: 'disabled' | 'offline' | 'connecting' | 'authenticating' | 'online' | 'backoff'
  readonly mode: RemoteSessionConfig['mode']
  readonly queued: number
  readonly deadLetter: number
  readonly inFlight: number
  /** Durability of the remote delivery queue, not the provider's local archive. */
  readonly durable: boolean
  readonly errorCode?: string
  readonly nextReconnectAt?: number
}

/** Candidate handshake result; contains no credentials or delivery data. */
export interface RemoteSessionProbeResult {
  readonly ok: boolean
  readonly endpoint: string
  readonly checkedAt: number
  readonly errorCode?:
    | 'invalid-configuration'
    | 'authentication-failed'
    | 'connection-failed'
    | 'timeout'
    | 'cancelled'
}
