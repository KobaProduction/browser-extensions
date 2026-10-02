const TOKEN_KEY = 'telemetryToken'

interface TelemetryMessage {
  type: 'chatgpt-booster:telemetry-post'
  url: string
  body: string
}

chrome.runtime.onMessage.addListener(
  (
    message: TelemetryMessage,
    _sender,
    sendResponse: (response: { ok: boolean; status?: number; error?: string }) => void,
  ) => {
    if (message?.type !== 'chatgpt-booster:telemetry-post') return

    void (async () => {
      try {
        const parsed = new URL(message.url)
        if (parsed.origin !== 'https://telemetry.koba-nexus.ru') {
          throw new Error('Telemetry origin is not allowlisted')
        }

        const stored = await chrome.storage.local.get(TOKEN_KEY)
        const token = typeof stored[TOKEN_KEY] === 'string' ? stored[TOKEN_KEY] : ''
        if (!token) throw new Error('Telemetry token is not configured')

        const response = await fetch(message.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: message.body,
        })

        if (!response.ok) throw new Error(`Telemetry HTTP ${response.status}`)
        sendResponse({ ok: true, status: response.status })
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'Telemetry request failed',
        })
      }
    })()

    return true
  },
)
