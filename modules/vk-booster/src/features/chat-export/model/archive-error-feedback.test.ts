import { expect, test } from 'bun:test'
import { vkArchiveErrorMessage } from './archive-error-feedback'

test('VK errors report safe and actionable classes without exposing arbitrary text', () => {
  expect(vkArchiveErrorMessage(Error('VK API 6'))).toContain('ограничил')
  expect(vkArchiveErrorMessage(Error('VK HTTP 403'))).toContain('доступ')
  expect(vkArchiveErrorMessage(Error('VK API 5'))).toContain('токен')
  expect(vkArchiveErrorMessage(Error('VK API 1116'))).toContain('токен')
  expect(vkArchiveErrorMessage(Error('VK peer changed during capture'))).toContain('переписка')
  expect(vkArchiveErrorMessage(Error('VK API authorization unavailable'))).toContain('Авторизация')
  const secret = 'private-session-identifier'
  expect(vkArchiveErrorMessage(Error(secret))).not.toContain(secret)
})
