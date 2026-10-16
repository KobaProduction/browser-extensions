import {
  type ApplicationLanguagePreference,
  type ApplicationLocaleController,
  type DeliveryTarget,
  instanceKey,
  isApplicationLanguage,
  type SettingsStore,
} from '@kobaproduction/browser-core'

declare function GM_getValue<T>(key: string, fallback?: T): T | Promise<T>
declare function GM_setValue(key: string, value: unknown): void | Promise<void>
declare function GM_addValueChangeListener(
  key: string,
  listener: (key: string, previous: unknown, next: unknown, remote: boolean) => void,
): number
declare function GM_removeValueChangeListener(id: number): void
const hasManagerStorage = () => typeof GM_getValue === 'function' && typeof GM_setValue === 'function'
const revisionKey = () => `${instanceKey('koba-browser')}:settings-revision`

/** Application settings share one manager scope across sites, with exact product/channel keys. */
export function createSettingsStore(target: DeliveryTarget, namespace = 'koba-browser'): SettingsStore {
  const prefix = `${instanceKey(namespace)}:`
  if (target === 'chromium')
    return {
      async get(key) {
        const value = (await chrome.storage.local.get(prefix + key))[prefix + key]
        return typeof value === 'boolean' ? value : undefined
      },
      async set(key, value) {
        await chrome.storage.local.set({ [prefix + key]: value })
      },
      async getText(key) {
        const value = (await chrome.storage.local.get(prefix + key))[prefix + key]
        return typeof value === 'string' ? value : undefined
      },
      async setText(key, value) {
        await chrome.storage.local.set({ [prefix + key]: value })
      },
    }
  return {
    async getText(key) {
      if (hasManagerStorage()) {
        const value = await GM_getValue<unknown>(prefix + key)
        if (typeof value === 'string') return value
        try {
          const previous = localStorage.getItem(prefix + key)
          if (previous !== null) {
            await GM_setValue(prefix + key, previous)
            return previous
          }
        } catch {
          /* The same installation's origin fallback may be unavailable. */
        }
        return undefined
      }
      try {
        return localStorage.getItem(prefix + key) ?? undefined
      } catch {
        return undefined
      }
    },
    async setText(key, value) {
      if (hasManagerStorage()) {
        await GM_setValue(prefix + key, value)
        await GM_setValue(revisionKey(), crypto.randomUUID())
      } else localStorage.setItem(prefix + key, value)
    },
    async get(key) {
      if (hasManagerStorage()) {
        const value = await GM_getValue<unknown>(prefix + key)
        if (typeof value === 'boolean') return value
        // Preserve only this exact installation's prior origin-local preferences.
        // This never reads sibling products/channels or provider data.
        try {
          const old = localStorage.getItem(prefix + key)
          if (old === 'true' || old === 'false') {
            await GM_setValue(prefix + key, old === 'true')
            return old === 'true'
          }
        } catch {
          /* Origin storage may be disabled independently of manager storage. */
        }
        return undefined
      }
      try {
        const value = localStorage.getItem(prefix + key)
        return value === 'true' ? true : value === 'false' ? false : undefined
      } catch {
        return undefined
      }
    },
    async set(key, value) {
      if (hasManagerStorage()) {
        await GM_setValue(prefix + key, value)
        await GM_setValue(revisionKey(), crypto.randomUUID())
      } else localStorage.setItem(prefix + key, String(value))
    },
  }
}

export function onInstallationStateChange(target: DeliveryTarget, listener: () => void): () => void {
  const prefix = `${instanceKey('koba-browser')}:`
  const keys = [
    'installation.enabled',
    'ui.launcher.enabled',
    'ui.site-entry.enabled',
    'ui.quick-menu.enabled',
    'ui.metrics.enabled',
    'ui.language',
  ].map((key) => prefix + key)
  const relevant = (key: string) =>
    keys.includes(key) ||
    (key.startsWith(prefix) &&
      /^features\.[a-z0-9-]+(?:\.modules\.[a-z0-9-]+)?\.enabled$/.test(key.slice(prefix.length)))
  if (target === 'chromium') {
    const changed = (items: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && Object.keys(items).some(relevant)) listener()
    }
    chrome.storage.onChanged.addListener(changed)
    return () => chrome.storage.onChanged.removeListener(changed)
  }
  if (
    hasManagerStorage() &&
    typeof GM_addValueChangeListener === 'function' &&
    typeof GM_removeValueChangeListener === 'function'
  ) {
    const id = GM_addValueChangeListener(revisionKey(), (_key, _before, _after, remote) => {
      if (remote) listener()
    })
    return () => GM_removeValueChangeListener(id)
  }
  const changed = (event: StorageEvent) => {
    if (event.key && relevant(event.key)) listener()
  }
  window.addEventListener('storage', changed)
  return () => window.removeEventListener('storage', changed)
}

/** Non-runtime surfaces consume the same scoped language as the application shell. */
export async function createInstallationLocale(
  target: DeliveryTarget,
): Promise<ApplicationLocaleController> {
  const store = createSettingsStore(target)
  const read = async (): Promise<ApplicationLanguagePreference> => {
    const value = await store.getText?.('ui.language')
    return isApplicationLanguage(value) ? value : 'auto'
  }
  let language = await read()
  let revision = 0
  let stop: (() => void) | undefined
  const listeners = new Set<() => void>()
  const refresh = async () => {
    const current = ++revision
    try {
      const next = await read()
      if (current !== revision || next === language) return
      language = next
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch {
          // Presentation failures cannot prevent another subscriber refreshing.
        }
      }
    } catch {
      // A failed refresh retains the last confirmed installation preference.
    }
  }
  return {
    current: () => language,
    subscribe(listener) {
      listeners.add(listener)
      if (listeners.size === 1) {
        stop = onInstallationStateChange(target, () => void refresh())
        void refresh()
      }
      return () => {
        listeners.delete(listener)
        if (!listeners.size) {
          revision++
          stop?.()
          stop = undefined
        }
      }
    },
  }
}
