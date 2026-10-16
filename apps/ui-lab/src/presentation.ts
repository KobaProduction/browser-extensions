/** Presentation only: never carry accounts, fixture records or running operations across hosts. */
export type LabSettingsCategory =
  | 'interface'
  | 'modules'
  | 'telemetry'
  | 'backup'
  | 'about'
  | `provider:chatgpt-booster:${'archive' | 'modules' | 'sounds' | 'analytics' | 'other' | 'triggers' | 'remote'}`
  | `provider:vk-booster:${'capture' | 'reader' | 'settings'}`
export function readLabSettingsCategory(value: unknown): LabSettingsCategory | undefined {
  if (typeof value !== 'string') return undefined
  return [
    'interface',
    'modules',
    'telemetry',
    'backup',
    'about',
    'provider:vk-booster:capture',
    'provider:vk-booster:reader',
    'provider:vk-booster:settings',
  ].includes(value) ||
    /^provider:chatgpt-booster:(archive|modules|sounds|analytics|other|triggers|remote)$/.test(value)
    ? (value as LabSettingsCategory)
    : undefined
}
export interface LabPresentation {
  surface: 'closed' | 'quick' | 'panel'
  view: 'settings' | 'archive' | 'capture' | 'shell-settings'
  section: 'modules' | 'archive' | 'analytics' | 'other' | 'sounds' | 'triggers' | 'remote'
  category?: LabSettingsCategory
}

export function readLabPresentation(value: unknown): LabPresentation | null {
  if (!value || typeof value !== 'object') return null
  const state = value as Record<string, unknown>
  if (
    !['closed', 'quick', 'panel'].includes(String(state.surface)) ||
    !['settings', 'archive', 'capture', 'shell-settings'].includes(String(state.view)) ||
    !['modules', 'archive', 'analytics', 'other', 'sounds', 'triggers', 'remote'].includes(
      String(state.section),
    )
  )
    return null
  const category = readLabSettingsCategory(state.category)
  return {
    surface: state.surface,
    view: state.view,
    section: state.section,
    category,
  } as LabPresentation
}
