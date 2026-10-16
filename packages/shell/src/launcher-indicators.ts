import type { FeatureIndicator } from '@kobaproduction/browser-core'

export const indicatorStatusText: Record<FeatureIndicator['status'], string> = {
  idle: 'Ожидание',
  active: 'Выполняется',
  success: 'Готово',
  warning: 'Требует внимания',
  error: 'Ошибка',
  offline: 'Нет соединения',
  connecting: 'Подключение',
}
export function indicatorDescription(
  indicator: FeatureIndicator,
  text: (caption: string) => string = (value) => value,
  english = false,
): string {
  const status = text(indicatorStatusText[indicator.status])
  const label = english ? (indicator.labelEn ?? indicator.label) : indicator.label
  const detail = english ? (indicator.detailEn ?? indicator.detail) : indicator.detail
  return `${label}: ${status}${detail ? `. ${detail}` : ''}`
}
export function launcherIndicatorTone(
  indicators: readonly FeatureIndicator[],
): 'idle' | 'active' | 'success' | 'warning' | 'error' {
  if (indicators.some((item) => item.status === 'error')) return 'error'
  if (indicators.some((item) => item.status === 'active' || item.status === 'connecting'))
    return 'active'
  if (indicators.some((item) => item.status === 'warning' || item.status === 'offline')) return 'warning'
  return indicators.some((item) => item.status === 'success') ? 'success' : 'idle'
}
