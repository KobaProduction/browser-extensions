import type { LanguagePreference } from '@chatgpt-booster/core'

export type SupportedLocale = 'en' | 'ru'

const messages = {
  en: {
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
    'control.transportCounters': 'Session transport counters',
    'control.requestsSent': 'Requests sent',
    'control.responsesReceived': 'Responses received',
    'control.messagesSent': 'Messages sent',
    'control.messagesReceived': 'Messages received',
    'control.errors': 'Errors',
    'control.saving': 'Saving…',
    'control.saved': 'Saved',
    'control.live': 'Settings apply live',

    'launcher.title': 'ChatGPT Booster — drag to move, click to open',

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
    'control.transportCounters': 'Счётчики транспорта за сессию',
    'control.requestsSent': 'Отправлено запросов',
    'control.responsesReceived': 'Получено ответов',
    'control.messagesSent': 'Отправлено сообщений',
    'control.messagesReceived': 'Получено сообщений',
    'control.errors': 'Ошибки',
    'control.saving': 'Сохранение…',
    'control.saved': 'Сохранено',
    'control.live': 'Настройки применяются сразу',

    'launcher.title': 'ChatGPT Booster — перетащите для перемещения, нажмите для открытия',

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
