import { readFileSync } from 'node:fs'
import { expect, test } from 'bun:test'
import { parse } from 'vue/compiler-sfc'

const panel = readFileSync(new URL('../src/features/archive/ui/ChatGptPanel.vue', import.meta.url), 'utf8')
const reader = readFileSync(new URL('../packages/ui/src/ArchiveBrowser.vue', import.meta.url), 'utf8')
const maintenance = readFileSync(new URL('../packages/ui/src/ArchiveMaintenanceWidget.vue', import.meta.url), 'utf8')
const feature = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

test('ChatGPT provider panel composes historical archive, capture, export and management views', () => {
  const { descriptor, errors } = parse(panel, { filename: 'ChatGptPanel.vue' })
  expect(errors).toHaveLength(0)
  expect(descriptor.scriptSetup).toBeTruthy()
  for (const widget of [
    'ArchiveBrowser', 'ArchiveExportDialog', 'CaptureSettingsSurface',
    'ArchiveMaintenanceWidget', 'ControlCenter', 'CopyIdentity',
  ]) {
    expect(descriptor.template?.content).toContain('<' + widget)
  }
  expect(descriptor.template?.content).toContain('Управление архивом и миграция')
  expect(descriptor.template?.content).toContain('Собрать историю')
  expect(descriptor.template?.content).toContain('Остановить загрузку')
  expect(panel).toContain('installBoosterShadowStyles(root)')
})

test('migration remains manual and retained behind an explicit archive action', () => {
  expect(panel).toContain('archiveMenuOpen=false; maintenanceOpen=true')
  expect(panel).toContain('v-if="maintenanceOpen && context"')
  expect(reader).toContain('@click="openMaintenance"')
  expect(maintenance).toContain('startArchiveMigration')
  expect(maintenance).toContain('inspectSkippedOwnershipAll')
  expect(maintenance).toContain('exportNativeSourceBackup')
  expect(maintenance).toContain('restoreCanonicalBackup')
})

test('no extra launcher or owner-scope confusion in provider panel', () => {
  expect(feature).toContain('createBoosterPageRuntime({ target, mountUi: false })')
  expect(panel).not.toContain('<BoosterOverlay')
  expect(panel).not.toContain('<ArchiveWorkspace')
  expect(panel).toContain('adapter.currentAccountId?.() ?? null')
  expect(panel).toContain('coverage.value = undefined')
  expect(panel).toContain("adapter.currentConversationId() !== conversationId")
  expect(panel).toContain('ARCHIVE_SOURCE_INCOMPATIBLE_EVENT')
})

test('hosted export wizard exposes format profiles and native/canonical backup entry without another shell', () => {
  const exporter = readFileSync(new URL('../packages/ui/src/ArchiveExportDialog.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(exporter, { filename: 'ArchiveExportDialog.vue' })
  expect(errors).toHaveLength(0)
  expect(descriptor.template?.content).toContain('chooseExportPreset')
  expect(descriptor.template?.content).toContain("emit('open-backups')")
  expect(panel).toContain('@open-backups="archiveMenuOpen=false; maintenanceOpen=true"')
  expect(exporter).not.toContain('<BoosterOverlay')
})

test('merged archive shell retains settings-backup and existing telemetry capabilities', () => {
  const settingsView = readFileSync(new URL('../packages/ui/src/ControlCenterPanel.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(settingsView, { filename: 'ControlCenterPanel.vue' })
  expect(errors).toHaveLength(0)
  // The PR #25 archive/export navigation must continue to host the settings
  // component augmented by PR #26, without another launcher.
  expect(panel).toContain(`v-else-if="tab==='settings'"`)
  expect(panel).toContain(':telemetry-control-adapter="context.telemetryControlAdapter"')
  expect(panel).toContain(':persistent-diagnostics-adapter="context.persistentDiagnosticsAdapter"')
  expect(panel).toContain('@open-backups="archiveMenuOpen=false; maintenanceOpen=true"')
  expect(settingsView).toContain("from './settings-backup'")
  expect(settingsView).toContain('exportChatGptSettings(props.settingsAdapter)')
  expect(settingsView).toContain('restoreChatGptSettings(props.settingsAdapter, settingsBackupFile.value)')
  expect(descriptor.template?.content).toContain('settingsBackupApproved')
  expect(descriptor.template?.content).toContain('Сохранить настройки')
  expect(descriptor.template?.content).toContain('Восстановить настройки')
  expect(settingsView).toContain('props.telemetryControlAdapter.test()')
  expect(panel).not.toContain('<BoosterOverlay')
})
