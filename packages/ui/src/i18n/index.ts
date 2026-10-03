import type { LanguagePreference } from '@chatgpt-booster/core'
import { archiveMessages } from './archive'

export type SupportedLocale = 'en' | 'ru'

const messages = {
  en: {
    ...archiveMessages.en,
    'common.on': 'On',
    'common.off': 'Off',
    'common.close': 'Close',
    'common.auto': 'Auto',
    'language.english': 'English',
    'language.russian': 'Русский',

    'control.title': 'ChatGPT Booster',
    'control.subtitle': 'Control Center',
    'control.loading': 'Loading settings…',
    'control.booster': 'Booster',
    'control.boosterDescription':
      'Master switch for page enhancements. Settings access always remains available.',
    'control.language': 'Language',
    'control.languageDescription': 'Automatically follows the browser language unless overridden.',
    'control.modules': 'Modules',
    'control.analytics': 'Analytics',
    'control.other': 'Other',
    'control.currentTab': 'Current tab',
    'control.allTime': 'All time',
    'control.toolInspector': 'Tool Inspector',
    'control.toolInspectorDescription':
      'Adds an Inspect control beside detected MCP/tool activity and exposes client-visible payloads, timestamps and DOM diagnostics.',
    'control.observer': 'Transport Observer',
    'control.observerDescription':
      'Passively observes fetch, XHR, WebSocket and EventSource activity without blocking requests.',
    'control.captureBodies': 'Capture body previews',
    'control.captureBodiesDescription':
      'Diagnostic mode. Captures redacted and truncated request/message previews.',
    'control.telemetry': 'Telemetry',
    'control.telemetryDescription': 'Exports sanitized Booster diagnostics over OTLP/HTTP.',
    'control.telemetryEndpoint': 'OTLP endpoint',
    'control.telemetryToken': 'Bearer token',
    'control.tokenConfigured': 'Token configured',
    'control.tokenMissing': 'Token not configured',
    'control.saveToken': 'Save token',
    'control.changeToken': 'Change',
    'control.cancel': 'Cancel',
    'control.testTelemetry': 'Test telemetry',
    'control.testingTelemetry': 'Testing…',
    'control.telemetryTestSuccess': 'Telemetry test succeeded',
    'control.telemetryTestFailed': 'Telemetry test failed',
    'control.telemetryEndpointPlaceholder': 'https://collector.example.com',
    'control.transportCounters': 'Transport counters',
    'control.requestsSent': 'Requests sent',
    'control.responsesReceived': 'Responses received',
    'control.messagesSent': 'Messages sent',
    'control.messagesReceived': 'Messages received',
    'control.errors': 'Errors',
    'control.saving': 'Saving…',
    'control.saved': 'Saved',
    'control.live': 'Settings apply live',

    'quick.title': 'Current chat',
    'quick.settings': 'Settings',
    'quick.currentConversation': 'Current conversation',
    'quick.project': 'Project',
    'quick.messages': 'Messages',
    'quick.branch': 'Branch',
    'quick.noConversation': 'No conversation',
    'quick.noConversationDescription': 'Open a ChatGPT conversation to use archive actions.',
    'quick.notArchived': 'Not archived yet',
    'quick.partial': 'Archive is partial',
    'quick.complete': 'Archive is complete',
    'quick.readToTop': 'Read older history',
    'quick.reread': 'Re-read from top',
    'quick.openArchive': 'Open archive',
    'quick.loadingHistory': 'Reading history…',
    'quick.pages': 'pages',
    'quick.stop': 'Stop',
    'quick.loaderError': 'History loader failed',

    'archive.title': 'Local archive',
    'archive.subtitle': 'Read-only · IndexedDB',
    'archive.refresh': 'Refresh',
    'archive.close': 'Close',
    'archive.back': 'Back',
    'archive.empty': 'The archive is empty. Open a chat so Booster can observe its history.',
    'archive.noProject': 'No project',
    'archive.project': 'Project',
    'archive.untitled': 'Untitled',
    'archive.showRaw': 'Show raw / metadata',
    'archive.hideRaw': 'Hide raw',
    'archive.selectConversation': 'Select a conversation on the left.',

    'launcher.title': 'ChatGPT Booster — drag to move, click for chat actions',

    'tool.inspect': 'Inspect',
    'tool.copyDiagnostics': 'Copy diagnostics',
    'tool.confidence': 'Confidence',
    'tool.clientPayload': 'Client-visible payload',
    'tool.noPayload': 'No structured arguments/result are exposed in this DOM block.',
    'tool.domEvidence': 'DOM evidence',

    'menu.openSettings': 'ChatGPT Booster: Open settings',
    'menu.openSettingsTitle': 'Open ChatGPT Booster Control Center',
  },
  ru: {
    ...archiveMessages.ru,
    'common.on': 'Вкл.',
    'common.off': 'Выкл.',
    'common.close': 'Закрыть',
    'common.auto': 'Авто',
    'language.english': 'English',
    'language.russian': 'Русский',

    'control.title': 'ChatGPT Booster',
    'control.subtitle': 'Центр управления',
    'control.loading': 'Загрузка настроек…',
    'control.booster': 'Booster',
    'control.boosterDescription':
      'Главный переключатель улучшений страницы. Доступ к настройкам остаётся всегда.',
    'control.language': 'Язык',
    'control.languageDescription':
      'Автоматически использует язык браузера, если не выбран вручную.',
    'control.modules': 'Модули',
    'control.analytics': 'Аналитика',
    'control.other': 'Прочее',
    'control.currentTab': 'Текущая вкладка',
    'control.allTime': 'За всё время',
    'control.toolInspector': 'Инспектор инструментов',
    'control.toolInspectorDescription':
      'Добавляет кнопку Inspect рядом с найденными MCP/инструментами и показывает доступные клиенту payload, время и DOM-диагностику.',
    'control.observer': 'Наблюдатель транспорта',
    'control.observerDescription':
      'Пассивно наблюдает fetch, XHR, WebSocket и EventSource, не блокируя запросы.',
    'control.captureBodies': 'Снимать превью body',
    'control.captureBodiesDescription':
      'Диагностический режим. Сохраняет очищенные и обрезанные превью запросов и сообщений.',
    'control.telemetry': 'Телеметрия',
    'control.telemetryDescription': 'Отправляет очищенную диагностику Booster по OTLP/HTTP.',
    'control.telemetryEndpoint': 'OTLP endpoint',
    'control.telemetryToken': 'Bearer token',
    'control.tokenConfigured': 'Токен настроен',
    'control.tokenMissing': 'Токен не настроен',
    'control.saveToken': 'Сохранить токен',
    'control.changeToken': 'Изменить',
    'control.cancel': 'Отмена',
    'control.testTelemetry': 'Тест телеметрии',
    'control.testingTelemetry': 'Проверка…',
    'control.telemetryTestSuccess': 'Телеметрия работает',
    'control.telemetryTestFailed': 'Ошибка телеметрии',
    'control.telemetryEndpointPlaceholder': 'https://collector.example.com',
    'control.transportCounters': 'Счётчики транспорта',
    'control.requestsSent': 'Отправлено запросов',
    'control.responsesReceived': 'Получено ответов',
    'control.messagesSent': 'Отправлено сообщений',
    'control.messagesReceived': 'Получено сообщений',
    'control.errors': 'Ошибки',
    'control.saving': 'Сохранение…',
    'control.saved': 'Сохранено',
    'control.live': 'Настройки применяются сразу',

    'quick.title': 'Текущий чат',
    'quick.settings': 'Настройки',
    'quick.currentConversation': 'Текущий диалог',
    'quick.project': 'Проект',
    'quick.messages': 'Сообщений',
    'quick.branch': 'Ветка',
    'quick.noConversation': 'Чат не открыт',
    'quick.noConversationDescription':
      'Откройте диалог ChatGPT, чтобы использовать действия архива.',
    'quick.notArchived': 'Ещё не архивирован',
    'quick.partial': 'Архив загружен частично',
    'quick.complete': 'Архив загружен полностью',
    'quick.readToTop': 'Дочитать историю',
    'quick.reread': 'Перечитать с начала',
    'quick.openArchive': 'Открыть архив',
    'quick.loadingHistory': 'Читаю историю…',
    'quick.pages': 'страниц',
    'quick.stop': 'Остановить',
    'quick.loaderError': 'Ошибка загрузчика истории',

    'archive.title': 'Локальный архив',
    'archive.subtitle': 'Только чтение · IndexedDB',
    'archive.refresh': 'Обновить',
    'archive.close': 'Закрыть',
    'archive.back': 'Назад',
    'archive.empty': 'Архив пока пуст. Откройте чат, чтобы Booster увидел его историю.',
    'archive.noProject': 'Без проекта',
    'archive.project': 'Проект',
    'archive.untitled': 'Без названия',
    'archive.showRaw': 'Показать raw / metadata',
    'archive.hideRaw': 'Скрыть raw',
    'archive.selectConversation': 'Выберите диалог слева.',

    'launcher.title': 'ChatGPT Booster — перетащите для перемещения, нажмите для действий чата',

    'tool.inspect': 'Inspect',
    'tool.copyDiagnostics': 'Копировать диагностику',
    'tool.confidence': 'Уверенность',
    'tool.clientPayload': 'Payload, доступный клиенту',
    'tool.noPayload': 'В этом DOM-блоке нет структурированных аргументов или результата.',
    'tool.domEvidence': 'DOM-данные',

    'menu.openSettings': 'ChatGPT Booster: Открыть настройки',
    'menu.openSettingsTitle': 'Открыть центр управления ChatGPT Booster',
  },
} as const

export type TranslationKey = keyof (typeof messages)['en']

export function detectBrowserLocale(
  languages: readonly string[] = navigator.languages?.length
    ? navigator.languages
    : [navigator.language],
): SupportedLocale {
  return languages.some((language) => language.toLowerCase().startsWith('ru')) ? 'ru' : 'en'
}

export function resolveLocale(
  preference: LanguagePreference,
  languages?: readonly string[],
): SupportedLocale {
  if (preference === 'ru' || preference === 'en') return preference
  return detectBrowserLocale(languages)
}

export function translate(locale: SupportedLocale, key: TranslationKey): string {
  return messages[locale][key] ?? messages.en[key]
}
