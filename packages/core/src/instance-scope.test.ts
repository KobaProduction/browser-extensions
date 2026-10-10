import { expect, test } from 'bun:test'
import { scopedIdentity } from './instance-scope'

test('six installed products/channels never alias stored state', () => {
  const scopes = [
    'vk-booster:dev',
    'vk-booster:prod',
    'chatgpt-booster:dev',
    'chatgpt-booster:prod',
    'all-in-one:dev',
    'all-in-one:prod',
  ]
  const identities = scopes.map((scope) => scopedIdentity('shared', scope))
  expect(new Set(identities).size).toBe(scopes.length)
})
test('existing prod standalone database names remain accessible, not silently migrated', () => {
  expect(
    scopedIdentity('chatgpt-booster-archive-v4', 'chatgpt-booster:prod', 'chatgpt-booster:prod'),
  ).toBe('chatgpt-booster-archive-v4')
  expect(
    scopedIdentity('chatgpt-booster-archive-v4', 'all-in-one:prod', 'chatgpt-booster:prod'),
  ).not.toBe('chatgpt-booster-archive-v4')
  expect(
    scopedIdentity('chatgpt-booster-archive-v4', 'chatgpt-booster:dev', 'chatgpt-booster:prod'),
  ).not.toBe('chatgpt-booster-archive-v4')
  expect(() => scopedIdentity('database', 'malformed')).toThrow()
})
