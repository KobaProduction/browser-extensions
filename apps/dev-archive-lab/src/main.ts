import { createApp } from 'vue'
import { createMemoryVkArchive } from '../../../modules/vk-booster/src/infrastructure/memory'
import { normalizeVkMessage } from '../../../modules/vk-booster/src/model/normalize'
import { initializeVkNativeArchive } from '../../../modules/vk-booster/src/native-runtime'
import ArchivePanel from '../../../modules/vk-booster/src/ui/ArchivePanel.vue'
import style from '../../../packages/shell/src/styles.css?inline'
import { createArchivePageFixture } from '../../../scripts/dev-harness/page-fixture'

// No network, real browser APIs, authentication or production IndexedDB.
const mockPeer = 7654321
const archivedPeer = 7654322
const samples = Array.from({ length: 580 }, (_, i) =>
  normalizeVkMessage(
    {
      id: 580 - i,
      date: 1791500000 - i * 1800,
      from_id: i % 2 ? mockPeer : 123,
      out: i % 2 ? 1 : 0,
      text:
        i % 7 === 0
          ? 'Пример длинного сообщения\nДве строки для просмотра'
          : `Тестовое сообщение ${580 - i}`,
      attachments:
        i % 13 === 0
          ? [{ type: 'doc', doc: { id: i + 2, title: 'Фото из документа ' + i + '.pdf' } }]
          : [],
    },
    mockPeer,
  ),
)
const fixture = createArchivePageFixture(samples, { delayMs: 90 })
const repo = createMemoryVkArchive('vk-booster:dev')
const source = {
  async history(peerId: number, offset: number, count: number) {
    if (peerId !== mockPeer) return { total: 0, messages: [] }
    const result = await fixture.page(offset, count)
    return { total: result.total, messages: result.items }
  },
  async attachmentBytes() {
    return new TextEncoder().encode('%PDF-1.7\nSynthetic fixture only\n%%EOF')
  },
}
// Second conversation proves archive-only mode can load without remote access.
await repo.storePage(archivedPeer, [
  normalizeVkMessage(
    { id: 1, date: 1791500000, from_id: 100, text: 'Архив уже собран и доступен офлайн.' },
    archivedPeer,
  ),
])
await repo.markComplete(archivedPeer)
history.replaceState(null, '', '/im/convo/' + mockPeer)
const simulatedMetrics: string[] = []
const native = initializeVkNativeArchive(repo, source, 'vk-booster:dev', {
  send(event) {
    simulatedMetrics.unshift(event.name + ' · count ' + (event.count ?? 0))
    simulatedMetrics.length = Math.min(6, simulatedMetrics.length)
    const target = document.getElementById('archive-lab-metrics')
    if (target) target.textContent = simulatedMetrics.join('  /  ')
  },
})
native.telemetry.setEnabled(true)
const host = document.getElementById('archive-lab')
if (!host) throw Error('Offline archive lab root missing')
const shadow = host.attachShadow({ mode: 'open' })
const css = document.createElement('style')
css.textContent = style
shadow.append(css)
const header = document.createElement('div')
header.className = 'booster-modal-surface'
header.style.cssText =
  'display:block;position:relative;inset:auto;margin:25px auto;max-width:830px;min-height:550px;padding:22px'
const note = document.createElement('div')
note.textContent = 'DEV Archive Lab · 580 синтетических сообщений · память браузера · без VK API'
note.style.cssText = 'font-size:12px;margin:0 0 15px;color:var(--muted-foreground)'
header.append(note)
const metrics = document.createElement('output')
metrics.id = 'archive-lab-metrics'
metrics.style.cssText = 'display:block;font-size:11px;color:var(--muted-foreground);margin:0 0 10px'
header.append(metrics)
const app = document.createElement('div')
header.append(app)
shadow.append(header)
createApp(ArchivePanel).mount(app)
