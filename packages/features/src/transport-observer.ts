import type {
  BoosterModule,
  BoosterSettings,
  createDiagnosticsStore,
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
  #current: BoosterSettings | undefined
  #unsubscribe: (() => void) | undefined

  constructor(options: {
    settings: SettingsAdapter
    diagnostics: DiagnosticsStore
    telemetry?: OtlpTelemetryClient
  }) {
    this.#settings = options.settings
    this.#diagnostics = options.diagnostics
    this.#telemetry = options.telemetry
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
          enabled: settings.enabled && settings.observer.enabled,
          captureBodies: settings.observer.captureBodies,
          maxBodyChars: settings.observer.maxBodyChars,
        },
      },
      '*',
    )
  }

  #onTransport = (event: MessageEvent) => {
    if (event.source !== window) return
    const data = event.data as {
      channel?: string
      type?: string
      detail?: TransportEventDetail
    }
    if (data?.channel !== TRANSPORT_CHANNEL || data.type !== TRANSPORT_EVENT) return

    const detail = data.detail
    if (!detail || !this.#current?.enabled || !this.#current.observer.enabled) return

    this.#diagnostics.recordTransport(detail)

    if (!this.#telemetry) return
    void this.#telemetry
      .emit({
        scope: 'transport-observer',
        name: `transport.${detail.kind}.${detail.phase}`,
        timestamp: detail.timestamp,
        severity: detail.phase === 'error' ? 'ERROR' : 'INFO',
        attributes: {
          'network.transport': detail.kind,
          'network.direction': detail.direction,
          'http.request.method': detail.method,
          'url.full': detail.url,
          'http.response.status_code': detail.status,
          'event.duration_ms': detail.durationMs,
          'http.response.body.size': detail.size,
          'http.response.header.content_type': detail.contentType,
          'chatgpt.body_preview': detail.bodyPreview,
        },
        body: detail.error ?? detail.bodyPreview ?? `${detail.kind} ${detail.phase}`,
      })
      .catch((error) => {
        console.warn('[ChatGPT Booster] Telemetry export failed', error)
      })
  }
}
