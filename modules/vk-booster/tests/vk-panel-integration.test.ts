import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { compileTemplate, parse } from 'vue/compiler-sfc'

const panel = readFileSync(
  new URL('../src/features/chat-export/ui/ArchivePanel.vue', import.meta.url),
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
    id: 'vk-v1-tabs',
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

test('capture and reader use only fixed Dexie and hide the historical folder writer', () => {
  expect(panel).toContain('v-show="tab === \'capture\'"')
  expect(panel).toContain('api.captureFixed(')
  expect(panel).toContain('api.readFixed(80, cursor)')
  expect(panel).toContain('api.exportFixed()')
  expect(panel).not.toContain('<ArchiveManager')
  expect(panel).not.toContain('api?.run(')
  expect(panel).not.toContain('chooseFolder')
  expect(panel).toContain('fixedPreview.value = []')
  expect(panel).toContain('role="alert"')
  expect(panel).toContain('Следующие 80')
})

test('peer-aware Dexie Reader retains only bounded local records and never exposes file paths', () => {
  expect(panel).toContain('hasVerifiedPeer')
  expect(panel).toContain('fixedNextCursor')
  expect(panel).not.toContain('<ArchivePreview')
  expect(panel).not.toContain('visibleSummary.folder')
  expect(reader).not.toContain(':href="receipt.')
  expect(panel).not.toContain('ArchiveCanonicalMigrator')
})

test('ordinary settings omit internal full-database recovery controls', () => {
  expect(panel).toContain("tab === 'settings'")
  expect(panel).toContain('exportVkCaptureSettings(api)')
  expect(panel).toContain('restoreVkCaptureSettings(')
  expect(panel).toContain('vkPreferencesPersistence()')
  expect(panel).toContain('await port.write(options)')
  expect(panel).toContain('preferencesConfirmed')
  expect(panel).toContain('status.folderPending || !!status.blockedReason')
  expect(panel).not.toContain('<PortableBackupPanel')
  expect(panel).not.toContain('api.backupPortable(')
  expect(panel).not.toContain('api.restorePortable(')
  expect(panel).not.toContain('restoreCanonicalBackup')
})
