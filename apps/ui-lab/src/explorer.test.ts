import { expect, test } from 'bun:test'
import { areaFromHash, areaScenes, areaView, previewProduct } from './explorer'

test('lab defaults to the map and supports route recovery', () => {
  expect(areaFromHash('')).toBe('home')
  expect(areaFromHash('#unknown')).toBe('home')
  expect(areaFromHash('#archive')).toBe('archive')
  expect(areaFromHash('#modules')).toBe('modules')
})
test('aggregate site selection does not multiply product choices', () => {
  expect(previewProduct('all-in-one', 'chatgpt')).toBe('all-in-one')
  expect(previewProduct('all-in-one', 'vk')).toBe('all-in-one-vk')
  expect(previewProduct('chatgpt', 'vk')).toBe('chatgpt')
  expect(previewProduct('vk', 'chatgpt')).toBe('vk')
})
test('archive fixtures and initial surfaces belong to their selected task', () => {
  expect(areaView('archive', 'closed')).toBe('archive')
  expect(areaView('modules', 'quick')).toBe('settings')
  expect(areaView('interface', 'closed')).toBe('closed')
  expect(areaScenes('archive').map((scene) => scene.id)).toContain('empty')
  expect(areaScenes('modules').map((scene) => scene.id)).toEqual(['saved', 'disabled'])
})
