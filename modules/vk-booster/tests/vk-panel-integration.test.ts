import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { compileTemplate, parse } from 'vue/compiler-sfc'

const panel = readFileSync(
  new URL('../src/features/chat-export/ui/ArchivePanel.vue', import.meta.url),
  'utf8',
)
const archive = readFileSync(
  new URL('../../../packages/widgets/src/ArchiveManager.vue', import.meta.url),
  'utf8',
)
const reader = readFileSync(
  new URL('../src/features/chat-export/ui/ArchivePreview.vue', import.meta.url),
  'utf8',
)
const feature = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

test('VK uses the existing single shell and accessible archive/export/settings navigation', () => {
  const { descriptor, errors } = parse(panel, { filename: 'ArchivePanel.vue' })
  expect(errors).toHaveLength(0)
  expect(descriptor.scriptSetup).toBeTruthy()
  const compiled = compileTemplate({
    source: descriptor.template?.content ?? '',
    filename: 'ArchivePanel.vue',
    id: 'vk-v2-tabs',
  })
  expect(compiled.errors).toHaveLength(0)
  expect(descriptor.template?.content).toContain('role="tablist"')
  expect(panel).toContain("status?.blockedReason ? 'secondary'")
  expect(panel).not.toContain("status?.blockedReason ? 'destructive'")
  expect(descriptor.template?.content).toContain('role="tabpanel"')
  expect(descriptor.template?.content).toContain(':aria-selected="tab === item.id"')
  expect(descriptor.template?.content).toContain(':aria-controls="tabPrefix +')
  expect(panel).toContain("event.key === 'ArrowRight'")
  expect(panel).toContain('onTabKeydown($event, item.id)')
  expect(panel).toContain('useId()')
  expect(panel).not.toContain('<BoosterOverlay')
  expect(panel).not.toContain('<ArchiveWorkspace')
  expect(feature).toContain("id: 'vk-booster'")
})

test('capture form stays mounted during navigation and uses the existing v2 engine', () => {
  expect(panel).toContain('v-show="tab === \'capture\'"')
  expect(panel).toContain('<ArchiveManager')
  expect(panel).toContain(':key="preferencesRevision"')
  expect(panel).toContain('@choose-folder="chooseFolder"')
  expect(panel).toContain('@start="start"')
  expect(panel).toContain('@stop="api?.stop()"')
  expect(panel).toContain('@resume="resume"')
  expect(archive).toContain("emit('start', {")
  expect(archive).toContain("emit('resume')")
  expect(panel).not.toContain('autoMigrate')
})

test('reader fails closed on a changed VK conversation or an incomplete folder selection', () => {
  expect(panel).toContain('presentVkArchive(status.value)')
  expect(panel).toContain('v-if="visibleSummary"')
  expect(panel).toContain('{{ visibleSummary.folder }} · Сообщений: {{ visibleSummary.messages }}')
  expect(panel).toContain(':state="view"')
  expect(panel).not.toContain('{{ status.folder }} · Сообщений: {{ status.messages }}')
  expect(panel).toContain('v-if="api && status && canReadArchive"')
  expect(panel).toContain('role="alert"')
  expect(reader).toContain('previewMessages')
  expect(reader).toContain('ArchiveTranscript')
  expect(reader).toContain('props.api.previewAttachments(')
  expect(reader).toContain('Вложения (по записям архива)')
  expect(reader).toContain('а не повторная проверка файла на диске')
  expect(reader).not.toContain(':href="receipt.')
  expect(reader).not.toContain(':src="receipt.')
  expect(panel).not.toContain('ArchiveCanonicalMigrator')
})

test('settings remain session-only with validated import and no invented archive recovery', () => {
  expect(panel).toContain("tab === 'settings'")
  expect(panel).toContain('exportVkCaptureSettings(api)')
  expect(panel).toContain('restoreVkCaptureSettings(api, preferencesFile.value)')
  expect(panel).toContain('preferencesConfirmed')
  expect(panel).toContain('status.folderPending || !!status.blockedReason')
  expect(panel).toContain('Полная резервная копия файлов архива v2 не создаётся')
  expect(panel).not.toContain('restoreCanonicalBackup')
})
