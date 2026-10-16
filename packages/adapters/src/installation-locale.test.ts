import { expect, test } from 'bun:test'
import { instanceKey } from '@kobaproduction/browser-core'
import { createInstallationLocale } from './settings-storage'

test('popup locale loads the scoped preference, follows changes and detaches its watcher', async () => {
  const previous = globalThis.chrome
  const key = `${instanceKey('koba-browser')}:ui.language`
  const values: Record<string, unknown> = { [key]: 'en', 'other-installation:ui.language': 'ru' }
  const listeners = new Set<
    (changes: Record<string, chrome.storage.StorageChange>, area: string) => void
  >()
  globalThis.chrome = {
    storage: {
      local: { get: async (name: string) => ({ [name]: values[name] }) },
      onChanged: {
        addListener: (
          listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void,
        ) => listeners.add(listener),
        removeListener: (
          listener: (changes: Record<string, chrome.storage.StorageChange>, area: string) => void,
        ) => listeners.delete(listener),
      },
    },
  } as unknown as typeof chrome
  try {
    const locale = await createInstallationLocale('chromium')
    expect(locale.current()).toBe('en')
    let updates = 0
    const stop = locale.subscribe(() => updates++)
    const settled = () => new Promise((resolve) => setTimeout(resolve, 0))
    await settled()
    for (const listener of listeners)
      listener({ 'other-installation:ui.language': { newValue: 'ru' } }, 'local')
    await settled()
    expect(updates).toBe(0)
    values[key] = 'ru'
    for (const listener of listeners) listener({ [key]: { newValue: 'ru' } }, 'local')
    await settled()
    expect(locale.current()).toBe('ru')
    expect(updates).toBe(1)
    stop()
    expect(listeners.size).toBe(0)
  } finally {
    globalThis.chrome = previous
  }
})
