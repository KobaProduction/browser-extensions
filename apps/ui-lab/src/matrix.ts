import type { LabMethod, LabProduct, LabScenario, LabScene, LabView } from './scenes'

export type LabViewport = 'desktop' | 'tablet' | 'mobile'
export type LabMatrixMode = 'smoke' | 'extended' | 'full'
export type LabMatrixCase = LabScenario & { readonly id: string; readonly viewport: LabViewport }
export interface LabMatrixResult {
  readonly id: string
  readonly status: 'pass' | 'fail'
  readonly warnings: readonly string[]
  readonly elapsedMs: number
}
export const viewportDimensions: Record<LabViewport, readonly [number, number]> = {
  desktop: [1365, 780],
  tablet: [768, 790],
  mobile: [390, 780],
}
const products: LabProduct[] = ['chatgpt', 'vk', 'all-in-one', 'all-in-one-vk']
const scenes: LabScene[] = ['saved', 'empty', 'loading', 'error', 'long', 'disabled']
const views: LabView[] = ['settings', 'quick', 'archive', 'closed']
const methods: LabMethod[] = ['tampermonkey', 'chromium']
const sides: Array<'left' | 'right'> = ['left', 'right']
const viewports: LabViewport[] = ['desktop', 'tablet', 'mobile']

/** Smoke covers every product × source-state × surface. Extended covers all viewports.
 * Full additionally crosses both delivery methods and both launcher edges. */
export function buildLabMatrix(mode: LabMatrixMode): readonly LabMatrixCase[] {
  const rows: LabMatrixCase[] = []
  for (let pi = 0; pi < products.length; pi++) {
    for (let si = 0; si < scenes.length; si++) {
      for (let vi = 0; vi < views.length; vi++) {
        const vp =
          mode === 'smoke' ? [viewports[(pi + si + vi) % viewports.length] ?? 'desktop'] : viewports
        for (const [zi, viewport] of vp.entries()) {
          const variants =
            mode === 'full'
              ? methods.flatMap((method) => sides.map((side) => ({ method, side })))
              : [
                  {
                    method: methods[(pi + si + vi + zi) % methods.length] ?? 'tampermonkey',
                    side: sides[(pi + vi + zi) % sides.length] ?? 'right',
                  },
                ]
          for (const { method, side } of variants) {
            const product = products[pi],
              scene = scenes[si],
              view = views[vi]
            if (!product || !scene || !view) throw Error('Invalid matrix generation indices')
            rows.push({
              id: `${product}:${scene}:${view}:${viewport}:${method}:${side}`,
              product,
              scene,
              view,
              viewport,
              method,
              side,
            })
          }
        }
      }
    }
  }
  return rows
}
export function matrixReport(
  mode: LabMatrixMode,
  cases: readonly LabMatrixCase[],
  results: readonly LabMatrixResult[],
) {
  // Vue callers supply reactive rows. Export independent plain data so both
  // postMessage structured cloning and CDP returnByValue retain the evidence.
  const failures = results
    .filter((row) => row.status === 'fail')
    .map(({ id, status, warnings, elapsedMs }) => ({
      id,
      status,
      warnings: [...warnings],
      elapsedMs,
    }))
  return {
    schemaVersion: 1,
    mode,
    viewports: Object.fromEntries(
      Object.entries(viewportDimensions).map(([name, size]) => [name, [...size]]),
    ),
    total: cases.length,
    executed: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    coverage: {
      product: [...new Set(results.map((row) => row.id.split(':')[0]))],
      states: [...new Set(results.map((row) => row.id.split(':')[1]))],
      surfaces: [...new Set(results.map((row) => row.id.split(':')[2]))],
      viewports: [...new Set(results.map((row) => row.id.split(':')[3]))],
      delivery: [...new Set(results.map((row) => row.id.split(':')[4]))],
      launcherEdges: [...new Set(results.map((row) => row.id.split(':')[5]))],
    },
    failures,
  }
}
