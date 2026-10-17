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
  expect(vkArchiveErrorMessage({ name: 'QuotaExceededError', message: secret })).toContain('места')
  expect(vkArchiveErrorMessage({ name: 'AbortError', message: secret })).toContain('вовремя')
  expect(vkArchiveErrorMessage(Error('VK history order changed during capture'))).toContain('страницы')
  expect(vkArchiveErrorMessage(Error('VK history paging made no progress'))).toContain('страницы')
  expect(vkArchiveErrorMessage(Error('VK network unavailable'))).toContain('соединение')
  expect(vkArchiveErrorMessage(Error('No saved VK messages for ZIP export'))).toContain('Сначала')
  expect(vkArchiveErrorMessage(Error('VK archive changed during export'))).toContain('повторно')
  expect(vkArchiveErrorMessage({ name: 'DataCloneError', message: secret })).toContain('IndexedDB')
  expect(vkArchiveErrorMessage(Error('VK API 100'))).toContain('API 100')
  expect(vkArchiveErrorMessage(Error('VK API 100 private-session-identifier'))).not.toContain(secret)
})
