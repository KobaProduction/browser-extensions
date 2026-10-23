/** Synthetic presentation fixture; no provider network, account or archive. */
import type { AgentActivitySnapshot } from '@chatgpt-booster/core'
import { mountRequestStatus } from '../../../modules/chatgpt-booster/packages/ui/src/request-status'

document.documentElement.style.cssText =
  'color-scheme:dark;background:#171717;color:#eee;font:14px system-ui'
const main = document.querySelector('main')
const anchor = document.getElementById('request-anchor')
if (!main || !anchor) throw new Error('Request status fixture target is missing')
main.style.cssText = 'max-width:720px;margin:40px auto;padding:16px'
anchor.textContent = 'Синтетический запрос: таймер, текущая фаза, время без изменений.'
const now = Date.now()
const snapshot: AgentActivitySnapshot = {
  conversationId: 'synthetic',
  turnId: 'synthetic',
  active: true,
  phase: 'thinking',
  startedAt: now - 95_000,
  completedAt: null,
  reasoningStartedAt: now - 65_000,
  phaseStartedAt: now - 65_000,
  lastActivityAt: now - 8_000,
  lastSummaryAt: now - 12_000,
  previousSummaryAt: now - 22_000,
  durationMs: null,
  reasoningDurationMs: null,
  label: null,
  tool: null,
}
const status = mountRequestStatus(anchor, snapshot, 'ru')
const ticker = setInterval(() => status.tick(Date.now()), 1000)
window.addEventListener(
  'pagehide',
  () => {
    clearInterval(ticker)
    status.unmount()
  },
  { once: true },
)
