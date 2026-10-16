import type { ChatGptAutomationStatus, HistoryLoaderState } from '@chatgpt-booster/core'
import type { FeatureIndicator } from '@kobaproduction/browser-core'

/** Technical state only: no identities, source text or server-delivery guesses. */
export function chatGptIndicators(
  automation: ChatGptAutomationStatus,
  collection: Readonly<HistoryLoaderState>,
  capture: { enabled: boolean; failed: boolean; remoteOnly: boolean },
): FeatureIndicator[] {
  const remote = automation.remote,
    syncing = ['preparing', 'queuing'].includes(automation.sync.state)
  const collecting = ['preparing', 'scrolling', 'waiting_for_load', 'backoff', 'saving'].includes(
    collection.phase,
  )
  const indicators: FeatureIndicator[] = [
    {
      id: 'connection',
      label: 'WebSocket',
      status:
        !remote || remote.state === 'disabled'
          ? 'idle'
          : remote.state === 'online'
            ? 'success'
            : ['connecting', 'authenticating'].includes(remote.state)
              ? 'connecting'
              : remote.state === 'backoff'
                ? 'warning'
                : 'offline',
      detail:
        !remote || remote.state === 'disabled'
          ? 'Выключен'
          : remote.state === 'online'
            ? 'Соединение установлено'
            : remote.state === 'backoff'
              ? 'Повтор подключения'
              : remote.state,
      detailEn:
        !remote || remote.state === 'disabled'
          ? 'Off'
          : remote.state === 'online'
            ? 'Connected'
            : remote.state === 'backoff'
              ? 'Reconnecting'
              : remote.state,
    },
    {
      id: 'capture',
      label: 'Сохранение',
      labelEn: 'Capture',
      status:
        capture.failed || collection.phase === 'error'
          ? 'error'
          : collecting
            ? 'active'
            : capture.enabled
              ? 'success'
              : 'idle',
      detail: capture.failed
        ? 'Ошибка сохранения'
        : collecting
          ? `Обработано: ${collection.knownMessageCount}`
          : capture.remoteOnly
            ? 'Только удалённо'
            : capture.enabled
              ? 'Автосохранение включено'
              : 'Автосохранение выключено',
      detailEn: capture.failed
        ? 'Capture failed'
        : collecting
          ? `Processed: ${collection.knownMessageCount}`
          : capture.remoteOnly
            ? 'Remote only'
            : capture.enabled
              ? 'Autosave on'
              : 'Autosave off',
    },
    {
      id: 'upload',
      label: 'Доставка',
      labelEn: 'Delivery',
      status:
        automation.sync.state === 'failed' || (remote?.deadLetter ?? 0) > 0
          ? 'error'
          : syncing || (remote?.inFlight ?? 0) > 0
            ? 'active'
            : automation.sync.state === 'queued' || (remote?.queued ?? 0) > 0
              ? 'warning'
              : 'idle',
      detail: syncing
        ? `Поставлено в очередь: ${automation.sync.queuedRows}`
        : automation.sync.state === 'queued'
          ? `В очереди: ${automation.sync.queuedRows} строк`
          : (remote?.deadLetter ?? 0) > 0
            ? `Ожидают повтора: ${remote?.deadLetter ?? 0}`
            : `В очереди: ${remote?.queued ?? 0}`,
      detailEn: syncing
        ? `Queued: ${automation.sync.queuedRows}`
        : automation.sync.state === 'queued'
          ? `Queued: ${automation.sync.queuedRows} rows`
          : (remote?.deadLetter ?? 0) > 0
            ? `Awaiting retry: ${remote?.deadLetter ?? 0}`
            : `Queued: ${remote?.queued ?? 0}`,
    },
  ]
  return indicators.filter((indicator) => indicator.id !== 'upload' || indicator.status !== 'idle')
}
