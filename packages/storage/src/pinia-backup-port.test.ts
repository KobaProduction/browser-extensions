import { expect, test } from 'bun:test'
import { createPiniaBackupPort } from './pinia-backup-port'

test('Pinia settings port persists only allowlisted values and reacts to restore', async () => {
  const state = { theme: 'dark', token: 'not-for-backups', pageSize: 80 }
  const notifications: string[] = []
  let stored = ''
  const port = createPiniaBackupPort({
    scope: { productId: 'sample-product', channel: 'dev' },
    schemaVersion: 1,
    store: {
      $state: state,
      $patch(fn) {
        fn(state)
        notifications.push(state.theme)
      },
    },
    pick: (s) => ({ theme: s.theme }),
    apply: (s, v) => {
      s.theme = v.theme
    },
    validate(input) {
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        Object.keys(input).join(',') !== 'theme' ||
        !['dark', 'light'].includes((input as { theme: string }).theme)
      )
        throw Error('Invalid theme')
      return { theme: (input as { theme: string }).theme }
    },
    async persist(v) {
      stored = v.theme
    },
  })
  expect(await port.exportSettings()).toEqual({ theme: 'dark' })
  await port.restoreSettingsAtomically({ theme: 'light' })
  expect(stored).toBe('light')
  expect(state).toEqual({ theme: 'light', token: 'not-for-backups', pageSize: 80 })
  expect(notifications).toEqual(['light'])
})
