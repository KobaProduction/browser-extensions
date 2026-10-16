import { expect, test } from 'bun:test'
import { clampLauncher, dropLauncher, launcherMenuGeometry } from './launcher-geometry'
import { indicatorDescription, launcherIndicatorTone } from './launcher-indicators'

test('expanded toolkit stays in viewport at either edge and free anchors', () => {
  for (const viewport of [
    { width: 390, height: 780 },
    { width: 768, height: 790 },
    { width: 1365, height: 780 },
    { width: 100, height: 90 },
  ]) {
    for (const side of ['left', 'right'] as const)
      for (const anchor of [
        { x: 0, y: 0 },
        { x: viewport.width - 44, y: viewport.height - 44 },
        { x: viewport.width / 2, y: viewport.height / 2 },
      ]) {
        const point = clampLauncher(anchor, viewport)
        const rect = launcherMenuGeometry(point, viewport, side)
        const left = point.x + rect.offsetX
        expect(left).toBeGreaterThanOrEqual(0)
        expect(left + rect.width).toBeLessThanOrEqual(viewport.width)
        expect(rect.contentHeight).toBeGreaterThanOrEqual(0)
        expect(rect.growsUp ? point.y - rect.contentHeight : point.y + 44 + rect.contentHeight).toBe(
          rect.growsUp ? 0 : viewport.height,
        )
      }
  }
})
test('only nearby edges attach; free drag keeps its released position', () => {
  const viewport = { width: 390, height: 780 }
  expect(dropLauncher({ x: 8, y: 300 }, viewport)).toMatchObject({ x: 0, y: 300, side: 'left' })
  expect(dropLauncher({ x: 340, y: 300 }, viewport)).toMatchObject({ x: 346, y: 300, side: 'right' })
  expect(dropLauncher({ x: 100, y: 300 }, viewport)).toMatchObject({ x: 100, y: 300, side: null })
})
test('status priority and labels convey state without relying on color', () => {
  const statuses = [
    { id: 'ws', label: 'WebSocket', status: 'connecting' as const },
    { id: 'capture', label: 'Захват', status: 'error' as const, detail: 'Запись недоступна' },
  ] as const
  expect(launcherIndicatorTone(statuses)).toBe('error')
  expect(indicatorDescription(statuses[0])).toBe('WebSocket: Подключение')
  expect(indicatorDescription(statuses[1])).toContain('Ошибка. Запись недоступна')
  expect(launcherIndicatorTone([])).toBe('idle')
})
