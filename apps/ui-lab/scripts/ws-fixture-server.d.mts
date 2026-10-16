export const SYNTHETIC_WS_TOKEN: 'ui-lab-synthetic-ws-token'
export interface FixtureCommandResult {
  readonly ok: boolean
  readonly errorCode?: string
  readonly result?: unknown
  readonly resultTransfer?: {
    readonly count: number
    readonly byteLength: number
    readonly sha256: string
  }
}
export interface WsFixtureServer {
  readonly endpoint: string
  readonly port: number
  readonly events: {
    id: string
    kind: string
    sha256: string
    payload: unknown
    version: 1
    scope: Record<string, unknown>
    sessionId: string
    sourceMode?: 'normalized' | 'raw'
  }[]
  readonly results: Map<string, FixtureCommandResult>
  readonly modes: { accepted: boolean; mode: 'raw' | 'normalized' }[]
  status(): {
    connections: number
    authenticated: number
    online: number
    events: number
    results: number
  }
  command(
    capability: string,
    payload?: unknown,
    options?: { id?: string; ttl?: number },
  ): Promise<FixtureCommandResult>
  requestMode(mode: 'raw' | 'normalized'): void
  disconnectAll(): void
  stop(): Promise<void>
}
export function createWsFixtureServer(options?: { port?: number; token?: string }): WsFixtureServer
