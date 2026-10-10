import { expect, test } from 'bun:test'
import { dockedIconRatios, dockedIconStyle, workspaceRatios, workspaceRect } from './window-geometry'

test('docked workspace preserves ratio settings and clamps on narrow screens', () => {
  const ratios = { xRatio: 0.08, yRatio: 0.08, widthRatio: 0.72, heightRatio: 0.82 }
  expect(workspaceRect(ratios, { width: 1000, height: 800 })).toEqual({
    x: 80,
    y: 64,
    width: 720,
    height: 656,
  })
  const narrow = workspaceRect(ratios, { width: 330, height: 280 })
  expect(narrow.width).toBe(320)
  expect(narrow.height).toBe(280)
  expect(narrow.x).toBe(8)
  expect(narrow.y).toBe(8)
  expect(
    workspaceRatios({ x: 80, y: 64, width: 720, height: 656 }, { width: 1000, height: 800 }),
  ).toEqual(ratios)
})
test('docked minimized icon supports side and bounded viewport offsets', () => {
  const viewport = { width: 1200, height: 800 }
  expect(dockedIconRatios(0, 420, viewport).minimizedSide).toBe('left')
  expect(dockedIconRatios(1140, 420, viewport).minimizedSide).toBe('right')
  expect(dockedIconStyle({ minimizedSide: 'right', minimizedHeightRatio: 0.5 }, viewport)).toEqual({
    left: '1158px',
    top: '379px',
  })
})
