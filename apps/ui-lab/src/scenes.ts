export type LabProduct = 'chatgpt' | 'vk' | 'all-in-one' | 'all-in-one-vk'
export type LabScene = 'saved' | 'empty' | 'loading' | 'error' | 'long' | 'disabled'
export type LabView = 'settings' | 'quick' | 'archive' | 'closed'
export type LabMethod = 'tampermonkey' | 'chromium'
export interface LabScenario {
  product: LabProduct
  scene: LabScene
  view: LabView
  method: LabMethod
  side: 'left' | 'right'
}
export function readScenario(search: string): LabScenario {
  const q = new URLSearchParams(search)
  const pick = <T extends string>(name: string, values: readonly T[], fallback: T): T =>
    values.includes(q.get(name) as T) ? (q.get(name) as T) : fallback
  return {
    product: pick('product', ['chatgpt', 'vk', 'all-in-one', 'all-in-one-vk'] as const, 'chatgpt'),
    scene: pick('scene', ['saved', 'empty', 'loading', 'error', 'long', 'disabled'] as const, 'saved'),
    view: pick('view', ['settings', 'quick', 'archive', 'closed'] as const, 'settings'),
    method: pick('method', ['tampermonkey', 'chromium'] as const, 'tampermonkey'),
    side: pick('side', ['left', 'right'] as const, 'right'),
  }
}
