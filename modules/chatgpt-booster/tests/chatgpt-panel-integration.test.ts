import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { compileTemplate, parse } from 'vue/compiler-sfc'

const panel = readFileSync(
  new URL('../src/features/archive/ui/ChatGptPanel.vue', import.meta.url),
  'utf8',
)
const reader = readFileSync(new URL('../packages/ui/src/ArchiveBrowser.vue', import.meta.url), 'utf8')
const feature = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

test('ChatGPT panel composes fixed Dexie archive, capture, export and settings views', () => {
  const { descriptor, errors } = parse(panel, { filename: 'ChatGptPanel.vue' })
  expect(errors).toHaveLength(0)
  expect(descriptor.scriptSetup).toBeTruthy()
  for (const widget of ['ArchiveBrowser', 'CaptureSettingsSurface', 'ControlCenter']) {
    expect(descriptor.template?.content).toContain(`<${widget}`)
  }
  expect(descriptor.template?.content).not.toContain('<ChatGptFixedArchiveSection')
  expect(descriptor.template?.content).not.toContain('Dexie — собственная структура v1')
  expect(descriptor.template?.content).toContain('<ConversationCollectionAction')
  expect(feature).toContain('quickActions: [')
  expect(descriptor.template?.content).toContain('stopCollection')
  expect(panel).toContain('installBoosterShadowStyles(root)')
})

test('legacy export and migration controls are absent from the clean product', () => {
  for (const token of [
    'saveLegacyReadOnly',
    'backupLegacyV3',
    'backupLegacyV4',
    'legacyBackupConfirmed',
    'ArchiveMaintenanceWidget',
    'Экспорт v3/v4',
  ]) {
    expect(panel).not.toContain(token)
  }
  expect(reader).not.toContain('openMaintenance')
  expect(reader).not.toContain('ArchiveMaintenanceWidget')
})

test('no extra launcher or owner-scope confusion in provider panel', () => {
  expect(feature).toMatch(/createBoosterPageRuntime\(\{\s*target,\s*mountUi:\s*false/)
  expect(panel).not.toContain('<BoosterOverlay')
  expect(panel).not.toContain('<ArchiveWorkspace')
  expect(panel).toContain('adapter.currentAccountId?.() ?? null')
  expect(panel).toContain('adapter.currentConversationId() !== conversationId')
  expect(panel).toContain('ARCHIVE_SOURCE_INCOMPATIBLE_EVENT')
})

test('Dexie-first export uses the existing shell without legacy backup controls', () => {
  const { descriptor, errors } = parse(panel, { filename: 'ChatGptPanel.vue' })
  expect(errors).toHaveLength(0)
  expect(descriptor.template?.content).toContain('<ArchiveExportDialog')
  expect(descriptor.template?.content).toContain(':selected-message-ids="selectedChat.messageIds"')
  expect(panel).not.toContain('backupLegacyV3')
  expect(panel).not.toContain('backupLegacyV4')
  expect(panel).not.toContain('legacyBackupConfirmed')
  expect(panel).not.toContain('<ArchiveMaintenanceWidget')
})

test('application owns one shared telemetry/recovery surface; provider retains no competing exporter', () => {
  const settingsView = readFileSync(
    new URL('../packages/ui/src/ControlCenterPanel.vue', import.meta.url),
    'utf8',
  )
  const { descriptor, errors } = parse(settingsView, { filename: 'ControlCenterPanel.vue' })
  expect(errors).toHaveLength(0)
  // The PR #25 archive/export navigation must continue to host the settings
  // component augmented by PR #26, without another launcher.
  expect(panel).toContain(`v-else-if="tab==='settings'"`)
  expect(panel).toContain(':telemetry-control-adapter="context.telemetryControlAdapter"')
  expect(panel).toContain(':persistent-diagnostics-adapter="context.persistentDiagnosticsAdapter"')
  expect(panel).not.toContain('maintenanceOpen=true')
  expect(settingsView).not.toContain('downloadSettingsBackup')
  expect(settingsView).not.toContain('importSettingsBackup')
  expect(descriptor.template?.content).not.toContain('Сохранить настройки')
  expect(descriptor.template?.content).not.toContain('Восстановить настройки')
  expect(settingsView).not.toContain('props.telemetryControlAdapter.test()')
  expect(settingsView).not.toContain('settings.telemetry')
  const sharedSettings = readFileSync(
    new URL('../../../packages/shell/src/ShellSettings.vue', import.meta.url),
    'utf8',
  )
  expect(sharedSettings).toContain('<ApplicationTelemetrySettings')
  expect(sharedSettings).toContain('<ApplicationBackupSettings')
  expect(panel).not.toContain('<BoosterOverlay')
})

test('new ChatGPT Dexie Reader/export lives inside the existing shared panel', () => {
  const { descriptor, errors } = parse(panel, { filename: 'ChatGptPanel.vue' })
  expect(errors).toHaveLength(0)
  const result = compileTemplate({
    source: descriptor.template?.content ?? '',
    filename: 'ChatGptPanel.vue',
    id: 'chatgpt-fixed-dexie',
  })
  expect(result.errors).toHaveLength(0)
  expect(feature).toContain('fixedArchive: page.fixedArchive')
  expect(panel).toContain(':archive-adapter="context.archiveAdapter"')
  expect(panel).toContain('selectedChat.value = { id, title, ...(messageIds ? { messageIds } : {}) }')
  expect(panel).not.toContain('<ChatGptFixedArchiveSection')
  expect(panel).not.toContain('<ArchiveWorkspace')
})

test('legacy-style quick menu commands open correct views without a second launcher', () => {
  expect(feature).toContain("id: 'settings'")
  expect(feature).toContain("id: 'archive'")
  expect(feature).toContain("id: 'collect'")
  expect(feature).toContain("id: 'export'")
  expect(feature).toContain('installation: target.label')
  expect(feature).toContain('version: BOOSTER_VERSION')
  expect(panel).toContain("if (section === 'collect') void collect()")
  expect(panel).toContain("if (section === 'export') void currentExport()")
  expect(panel).not.toContain('<BoosterOverlay')
})
