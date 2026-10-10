export {}

const button = document.getElementById('open') as HTMLButtonElement
const status = document.getElementById('status') as HTMLElement
button.onclick = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab?.id || !/^https:\/\/(?:(?:vk\.ru|vk\.com)\/im|chatgpt\.com\/)/.test(tab.url || '')) {
      status.textContent = 'Откройте VK или ChatGPT'
      return
    }
    await chrome.tabs.sendMessage(tab.id, { type: 'koba:open' })
    window.close()
  } catch {
    status.textContent = 'Откройте поддерживаемый сайт и обновите вкладку'
  }
}
