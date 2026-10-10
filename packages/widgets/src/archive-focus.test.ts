import { expect, test } from 'bun:test'
import { selectArchiveFocus } from './archive-focus'

test('viewport reader keeps explicit branch selection only while that message is visible', () => {
  const bounds = { top: 100, bottom: 340, height: 240 }
  const nodes = [
    { key: 'previous', top: 80, bottom: 145 },
    { key: 'near', top: 164, bottom: 208 },
    { key: 'later', top: 280, bottom: 326 },
  ]
  expect(selectArchiveFocus(bounds, nodes, 'later')).toEqual({ key: 'later', retainsPin: true })
  expect(selectArchiveFocus(bounds, nodes, 'offscreen')).toEqual({ key: 'near', retainsPin: false })
  expect(selectArchiveFocus(bounds, [], null)).toEqual({ key: null, retainsPin: false })
})
