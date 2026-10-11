/**
 * Scope is provided by Chrome's own extension identity (a DEV ID differs
 * from PROD). Never reaches a different extension or bypasses its content
 * runtime settings. The installed page remains loaded during toggles.
 */
export function attachChromeInstallationToggle(host: HTMLElement, allowedHost: RegExp): void {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = 'Состояние установки'
  button.setAttribute('aria-label', 'Включить или выключить эту версию расширения')
  const feedback = document.createElement('p')
  feedback.setAttribute('role', 'status')
  host.append(button, feedback)

  async function currentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !allowedHost.test(tab.url ?? '')) throw Error('Open the supported page')
    return tab.id
  }
  async function refresh() {
    try {
      const id = await currentTab()
      const response: { enabled?: boolean } = await chrome.tabs.sendMessage(id, {
        type: 'koba:installation-status',
      })
      if (typeof response?.enabled !== 'boolean') throw Error('No active runtime')
      button.textContent = response.enabled ? 'Выключить эту версию' : 'Включить эту версию'
      button.dataset.enabled = String(response.enabled)
      feedback.textContent = ''
      button.disabled = false
    } catch {
      feedback.textContent =
        'Откройте поддерживаемую страницу. Если скрипт ещё не загрузился, обновите её один раз.'
      button.disabled = true
    }
  }
  button.addEventListener('click', async () => {
    button.disabled = true
    try {
      const id = await currentTab()
      const enabled = button.dataset.enabled !== 'true'
      const answer = (await chrome.tabs.sendMessage(id, {
        type: 'koba:installation-set-running',
        enabled,
      })) as { ok?: boolean }
      if (!answer?.ok) throw Error('Toggle failed')
      await refresh()
    } catch {
      feedback.textContent = 'Не удалось переключить установку'
      button.disabled = false
    }
  })
  void refresh()
}
