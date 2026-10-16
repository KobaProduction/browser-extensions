import type { FeatureRuntime } from '@kobaproduction/browser-core'

export interface BrowserToolsController {
  openSettings(): void
  openMenu(): void
}

/** One command boundary for every MV3 product; storage remains scoped by extension identity. */
export function bindBrowserToolsMessages(
  runtime: FeatureRuntime,
  ui: BrowserToolsController,
): () => void {
  const listener = (
    message: { type?: string; id?: string; enabled?: boolean },
    _sender: chrome.runtime.MessageSender,
    respond: (response: unknown) => void,
  ) => {
    if (message?.type === 'koba:settings-open' || message?.type === 'koba:open') {
      ui.openSettings()
      respond({ ok: true })
      return
    }
    if (message?.type === 'koba:menu-open') {
      ui.openMenu()
      respond({ ok: true })
      return
    }
    if (message?.type === 'koba:installation-status' || message?.type === 'koba:list') {
      respond({
        enabled: runtime.isRunning(),
        features: runtime.list(),
        shell: runtime.shellPreferences(),
      })
      return
    }
    if (message?.type === 'koba:installation-set-running') {
      if (typeof message.enabled !== 'boolean') {
        respond({ ok: false })
        return
      }
      void runtime
        .setRunning(message.enabled)
        .then(() => respond({ ok: true }))
        .catch(() => respond({ ok: false }))
      return true
    }
    if (message?.type === 'koba:open-feature' && message.id) {
      void runtime
        .open(message.id)
        .then(() => respond({ ok: true }))
        .catch(() => respond({ ok: false }))
      return true
    }
  }
  chrome.runtime.onMessage.addListener(listener)
  return () => chrome.runtime.onMessage.removeListener(listener)
}

export interface BrowserToolsPopupCommands {
  openSettings(): Promise<void>
  openMenu(): Promise<void>
}
export type BrowserToolsPopupRenderer = (
  host: HTMLElement,
  commands: BrowserToolsPopupCommands,
) => { destroy(): void }

/** Target-only command port. Shared Shell owns popup controls, theme and user feedback. */
export function createBrowserToolsPopupCommands(allowedHost: RegExp): BrowserToolsPopupCommands {
  const send = async (type: 'koba:settings-open' | 'koba:menu-open') => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    allowedHost.lastIndex = 0
    if (!tab?.id || !allowedHost.test(tab.url ?? '')) throw Error('Unsupported page')
    const answer: { ok?: boolean } = await chrome.tabs.sendMessage(tab.id, { type })
    if (!answer?.ok) throw Error('No runtime')
  }
  return { openSettings: () => send('koba:settings-open'), openMenu: () => send('koba:menu-open') }
}

/** Compatibility composition requires an explicit shared renderer; no native-control fallback. */
export function attachBrowserToolsPopup(
  host: HTMLElement,
  allowedHost: RegExp,
  render: BrowserToolsPopupRenderer,
): { destroy(): void } {
  return render(host, createBrowserToolsPopupCommands(allowedHost))
}
