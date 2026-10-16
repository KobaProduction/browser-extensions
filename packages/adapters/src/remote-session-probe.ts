import {
  DEFAULT_REMOTE_SESSION_CONFIG,
  normalizeRemoteSessionConfig,
  type RemoteSessionProbeResult,
} from '@kobaproduction/browser-core'

export type { RemoteSessionProbeResult } from '@kobaproduction/browser-core'

import {
  assertMatchingScope,
  assertServiceScope,
  type ServiceScope,
} from '@kobaproduction/browser-storage'

export interface RemoteSessionProbeOptions {
  readonly scope: ServiceScope
  readonly endpoint: string
  readonly token: string
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}
/** Isolated auth/ready handshake. No delivery queue, archive, subscription or settings write. */
export async function probeRemoteSession(
  options: RemoteSessionProbeOptions,
): Promise<RemoteSessionProbeResult> {
  let endpoint = options.endpoint
  const failure = (errorCode: RemoteSessionProbeResult['errorCode']): RemoteSessionProbeResult => ({
    ok: false,
    endpoint,
    checkedAt: Date.now(),
    errorCode,
  })
  try {
    assertServiceScope(options.scope)
    normalizeRemoteSessionConfig({ ...DEFAULT_REMOTE_SESSION_CONFIG, endpoint })
    const url = new URL(endpoint)
    if (url.protocol === 'ws:' && options.scope.channel !== 'dev')
      return failure('invalid-configuration')
    endpoint = url.href
    if (
      !options.token ||
      options.token.length > 16384 ||
      !Number.isSafeInteger(options.timeoutMs ?? 5000) ||
      (options.timeoutMs ?? 5000) < 100 ||
      (options.timeoutMs ?? 5000) > 30000
    )
      return failure('invalid-configuration')
  } catch {
    return failure('invalid-configuration')
  }
  if (options.signal?.aborted) return failure('cancelled')
  return new Promise((resolve) => {
    let socket: WebSocket | undefined,
      settled = false
    const sessionId = crypto.randomUUID(),
      scope = { ...options.scope }
    const finish = (result: RemoteSessionProbeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', aborted)
      if (socket) {
        socket.onmessage = null
        socket.onerror = null
        socket.onclose = null
        socket.close(1000, 'probe-finished')
      }
      resolve(result)
    }
    const aborted = () => finish(failure('cancelled'))
    const timer = setTimeout(() => finish(failure('timeout')), options.timeoutMs ?? 5000)
    options.signal?.addEventListener('abort', aborted, { once: true })
    try {
      const connection = new WebSocket(endpoint)
      socket = connection
      connection.onopen = () => {
        if (settled) return
        connection.send(
          JSON.stringify({ type: 'auth', version: 1, scope, sessionId, token: options.token }),
        )
        connection.send(
          JSON.stringify({ type: 'hello', version: 1, scope, sessionId, probe: true, capabilities: [] }),
        )
      }
      connection.onmessage = (event) => {
        if (typeof event.data !== 'string' || event.data.length > 16384) return
        try {
          const value = JSON.parse(event.data)
          if (value?.version !== 1 || value.sessionId !== sessionId) return
          assertMatchingScope(scope, value.scope)
          if (value.type === 'ready') finish({ ok: true, endpoint, checkedAt: Date.now() })
          else if (value.type === 'auth-error') finish(failure('authentication-failed'))
        } catch {
          /* Unmatched frames do not prove authentication. */
        }
      }
      connection.onerror = () => finish(failure('connection-failed'))
      connection.onclose = (event) =>
        finish(failure(event.code === 1008 ? 'authentication-failed' : 'connection-failed'))
    } catch {
      finish(failure('connection-failed'))
    }
  })
}
