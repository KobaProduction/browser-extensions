import type {
  BoosterModule,
  BoosterSettings,
  createDiagnosticsStore,
  PersistentDiagnosticsAdapter,
  SettingsAdapter,
} from '@chatgpt-booster/core'
import {
  TRANSPORT_CHANNEL,
  TRANSPORT_CONFIG_EVENT,
  TRANSPORT_EVENT,
  type TransportEventDetail,
} from '@chatgpt-booster/observer'
import type { OtlpTelemetryClient } from '@chatgpt-booster/telemetry'

type DiagnosticsStore = ReturnType<typeof createDiagnosticsStore>

export class TransportObserverModule implements BoosterModule {
  readonly id = 'transport-observer'

  readonly #settings: SettingsAdapter
  readonly #diagnostics: DiagnosticsStore
  readonly #telemetry: OtlpTelemetryClient | undefined
  readonly #persistentDiagnostics: PersistentDiagnosticsAdapter | undefined
  #current: BoosterSettings | undefined
  #unsubscribe: (() => void) | undefined

  constructor(options: {
    settings: SettingsAdapter
    diagnostics: DiagnosticsStore
    telemetry?: OtlpTelemetryClient
    persistentDiagnostics?: PersistentDiagnosticsAdapter
  }) {
    this.#settings = options.settings
    this.#diagnostics = options.diagnostics
    this.#telemetry = options.telemetry
    this.#persistentDiagnostics = options.persistentDiagnostics
  }

  async start() {
    this.#current = await this.#settings.get()
    this.#publishConfig(this.#current)

    window.addEventListener('message', this.#onTransport)
    this.#unsubscribe = this.#settings.subscribe((next) => {
      this.#current = next
      this.#publishConfig(next)
    })
  }

  stop() {
    window.removeEventListener('message', this.#onTransport)
    this.#unsubscribe?.()
    this.#unsubscribe = undefined
  }

  #publishConfig(settings: BoosterSettings) {
    window.postMessage(
      {
        channel: TRANSPORT_CHANNEL,
        type: TRANSPORT_CONFIG_EVENT,
        detail: {
          captureBodies:
            settings.enabled && settings.observer.enabled && settings.observer.captureBodies,
          maxBodyChars: settings.observer.maxBodyChars,
        },
      },
      '*',
    )
  }

  #onTransport = (event: MessageEvent) => {
    if (event.origin && event.origin !== window.location.origin) return
    const data = event.data as {
      channel?: string
      type?: string
      detail?: TransportEventDetail
    }
    if (data?.channel !== TRANSPORT_CHANNEL || data.type !== TRANSPORT_EVENT) return

    const detail = data.detail
    if (!detail || !this.#current?.enabled || !this.#current.observer.enabled) return

    this.#diagnostics.recordTransport(detail)
    void this.#persistentDiagnostics?.recordTransport(detail).catch((error) => {
      console.warn('[ChatGPT Booster] Analytics persistence failed', error)
    })

    if (!this.#telemetry) return
    void this.#telemetry
      .emit({
        scope: 'transport-observer',
        name: `transport.${detail.kind}.${detail.phase}`,
        timestamp: detail.timestamp,
        severity:
          detail.phase !== 'error'
            ? 'INFO'
            : detail.errorClass === 'aborted' ||
                detail.errorClass === 'socket' ||
                detail.errorClass === 'stream'
              ? 'WARN'
              : 'ERROR',
        attributes: {
          'network.transport': detail.kind,
          'network.direction': detail.direction,
          'http.request.method': detail.method,
          'url.full': detail.url,
          'http.response.status_code': detail.status,
          'event.duration_ms': detail.durationMs,
          'http.response.body.size': detail.size,
          'http.response.header.content_type': detail.contentType,
          'error.class': detail.errorClass,
        },
        body: detail.error ?? `${detail.kind} ${detail.phase}`,
      })
      .catch((error) => {
        console.warn('[ChatGPT Booster] Telemetry export failed', error)
      })
  }
}
