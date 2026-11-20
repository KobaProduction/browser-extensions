import type { FeatureQuickAction, FeatureSettingsCategory } from '@kobaproduction/browser-core'

export const CHATGPT_SETTINGS_CATEGORIES = [
  {
    id: 'archive',
    title: 'Сохранение',
    titleEn: 'Capture',
    description: 'Политика захвата, история и чтение',
    descriptionEn: 'Capture policy, history and reading',
  },
  {
    id: 'modules',
    title: 'Модули',
    titleEn: 'Modules',
    description: 'Метаданные, активность, таймер и инструменты',
    descriptionEn: 'Metadata, activity, timer and tools',
  },
  {
    id: 'sounds',
    title: 'Звуки',
    titleEn: 'Sounds',
    description: 'Отправка, завершение ответа и конец контекста',
    descriptionEn: 'Sending, response completion and context limits',
  },
  {
    id: 'triggers',
    title: 'Триггеры',
    titleEn: 'Triggers',
    description: 'События, условия и действия',
    descriptionEn: 'Events, conditions and actions',
  },
  {
    id: 'remote',
    title: 'Сервер и синхронизация',
    titleEn: 'Server and sync',
    description: 'WebSocket, очередь и удалённые команды',
    descriptionEn: 'WebSocket, queue and remote commands',
  },
  {
    id: 'analytics',
    title: 'Сетевая активность',
    titleEn: 'Network activity',
    description: 'Локальные технические счётчики',
    descriptionEn: 'Local technical counters',
  },
] as const satisfies readonly FeatureSettingsCategory[]

/** The old saved settings category remains readable. */
export function chatGptSettingsCategory(id: string) {
  if (id === 'other') return 'modules'
  return CHATGPT_SETTINGS_CATEGORIES.find((category) => category.id === id)?.id
}

export function chatGptArchiveAction(
  run: FeatureQuickAction['run'],
  isActive: () => boolean,
): FeatureQuickAction {
  return {
    id: 'archive',
    label: 'Открыть архив',
    labelEn: 'Open archive',
    icon: 'archive',
    workspaceTab: { title: 'Локальный архив', titleEn: 'Local archive', isActive },
    run,
  }
}
