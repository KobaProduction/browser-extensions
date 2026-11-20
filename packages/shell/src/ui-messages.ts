export const SHELL_UI_MESSAGES: Readonly<Record<string, string>> = {
  'Настройки приложения и инструменты текущей страницы.':
    'Application settings and tools for the current page.',
  'Откройте поддерживаемый сайт. Если расширение ещё не загрузилось, обновите вкладку.':
    'Open a supported site. Reload the tab if the extension has not loaded yet.',
  'Открыть настройки': 'Open settings',
  'Показать меню': 'Show menu',
  Включить: 'Enable',
  Отключить: 'Disable',
  'Включить функции расширения': 'Enable extension features',
  'Отключить функции расширения': 'Disable extension features',
  Закрыть: 'Close',
  'Модульные инструменты браузера': 'Modular browser tools',
  'Не удалось переключить функции': 'Could not toggle features',
  'Не удалось открыть настройки продукта': 'Could not open product settings',
  'Не удалось открыть действие': 'Could not open the action',
  активен: 'active',
  'Состояние подключения и операций': 'Connection and operation status',
  'Настройки Browser Tools': 'Browser Tools settings',
  Ожидание: 'Idle',
  Выполняется: 'Running',
  Готово: 'Ready',
  'Требует внимания': 'Needs attention',
  Ошибка: 'Error',
  'Нет соединения': 'Offline',
  Подключение: 'Connecting',
}

export function pagePowerLabel(
  { enabled, feature }: { enabled: boolean; feature?: { title: string; titleEn?: string } | undefined },
  locale: 'ru' | 'en',
) {
  const key = feature
    ? enabled
      ? 'Отключить'
      : 'Включить'
    : enabled
      ? 'Отключить функции расширения'
      : 'Включить функции расширения'
  const label = locale === 'en' ? (SHELL_UI_MESSAGES[key] ?? key) : key
  if (!feature) return label
  return `${label} ${locale === 'en' ? (feature.titleEn ?? feature.title) : feature.title}`
}
