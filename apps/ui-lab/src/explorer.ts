import type { LabProduct, LabScene, LabView } from './scenes'

export type LabArea = 'home' | 'interface' | 'archive' | 'modules' | 'matrix'
export type LabInstallation = 'chatgpt' | 'vk' | 'all-in-one'
export type LabSite = 'chatgpt' | 'vk'
export const labAreas = [
  {
    id: 'interface',
    title: 'Интерфейс расширения',
    description: 'Боковая кнопка, быстрое меню и панель. Проверьте открытие, закрытие и разные экраны.',
    detail: 'Кнопка → меню → панель',
    icon: 'layout',
  },
  {
    id: 'archive',
    title: 'Архив и данные',
    description: 'Чтение переписок, состояния загрузки, пустой архив и длинные сообщения.',
    detail: 'Сценарий → данные → просмотр',
    icon: 'archive',
  },
  {
    id: 'modules',
    title: 'Модули и настройки',
    description: 'Включение функций, настройки сохранения и аналитика. Без лишних параметров архива.',
    detail: 'Продукт → раздел → проверка',
    icon: 'settings',
  },
  {
    id: 'matrix',
    title: 'Автоматические проверки',
    description: 'Запуск сценариев на всех размерах экрана, результаты и отчёт о нарушениях.',
    detail: 'Набор проверок → результаты',
    icon: 'check',
  },
] as const

export function areaFromHash(hash: string): LabArea {
  const id = hash.replace(/^#/, '')
  return labAreas.some((area) => area.id === id) ? (id as LabArea) : 'home'
}
export function previewProduct(installation: LabInstallation, site: LabSite): LabProduct {
  return installation === 'all-in-one' ? (site === 'vk' ? 'all-in-one-vk' : 'all-in-one') : installation
}
export function areaView(area: LabArea, surface: LabView): LabView {
  return area === 'archive' ? 'archive' : area === 'modules' ? 'settings' : surface
}
export function areaScenes(area: LabArea): readonly { id: LabScene; title: string }[] {
  return area === 'archive'
    ? [
        { id: 'saved', title: 'Сохранённые переписки' },
        { id: 'empty', title: 'Пустой архив' },
        { id: 'loading', title: 'Загрузка' },
        { id: 'error', title: 'Ошибка источника' },
        { id: 'long', title: 'Длинные сообщения' },
        { id: 'disabled', title: 'Расширение выключено' },
      ]
    : [
        { id: 'saved', title: 'Расширение включено' },
        { id: 'disabled', title: 'Расширение выключено' },
      ]
}
