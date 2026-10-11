import { readFileSync } from 'node:fs'
import { expect, test } from 'bun:test'
import { compileTemplate, parse } from 'vue/compiler-sfc'

const panel = readFileSync(new URL('../src/features/archive/ui/ChatGptPanel.vue', import.meta.url), 'utf8')
const reader = readFileSync(new URL('../packages/ui/src/ArchiveBrowser.vue', import.meta.url), 'utf8')
const feature = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
const actions = readFileSync(new URL('../src/features/archive/ui/ChatGptArchiveActions.vue', import.meta.url), 'utf8')
const fixedView = readFileSync(new URL('../src/features/archive/ui/ChatGptFixedArchiveSection.vue', import.meta.url), 'utf8')

test('ChatGPT panel composes fixed Dexie archive, capture, export and settings views', () => {
  const { descriptor, errors } = parse(panel, { filename: 'ChatGptPanel.vue' })
  expect(errors).toHaveLength(0)
  expect(descriptor.scriptSetup).toBeTruthy()
  for (const widget of [
    'ArchiveBrowser', 'CaptureSettingsSurface',
    'ControlCenter', 'CopyIdentity',
  ]) {
    expect(descriptor.template?.content).toContain('<' + widget)
  }
  expect(descriptor.template?.content).toContain('<ChatGptFixedArchiveSection')
  expect(fixedView).toContain('Dexie — собственная структура v1')
  expect(descriptor.template?.content).toContain('<ChatGptArchiveActions')
  expect(actions).toContain('Собрать историю')
  expect(actions).toContain('watch(() => props.tab')
  expect(descriptor.template?.content).toContain('Остановить загрузку')
  expect(panel).toContain('installBoosterShadowStyles(root)')
})

test('legacy export and migration controls are absent from the clean product', () => {
  for (const token of [
    'saveLegacyReadOnly', 'backupLegacyV3', 'backupLegacyV4',
    'legacyBackupConfirmed', 'ArchiveMaintenanceWidget', 'Экспорт v3/v4',
  ]) {
    expect(panel).not.toContain(token)
  }
  expect(reader).not.toContain('openMaintenance')
  expect(reader).not.toContain('ArchiveMaintenanceWidget')
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

test('Dexie-first export uses the existing shell without legacy backup controls', () => {
  const { descriptor, errors } = parse(panel, { filename: 'ChatGptPanel.vue' })
  expect(errors).toHaveLength(0)
  expect(descriptor.template?.content).toContain('exportSelectedDexie')
  expect(panel).not.toContain('backupLegacyV3')
  expect(panel).not.toContain('backupLegacyV4')
  expect(panel).not.toContain('legacyBackupConfirmed')
  expect(panel).not.toContain('<ArchiveExportDialog')
  expect(panel).not.toContain('<ArchiveMaintenanceWidget')
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
  expect(panel).not.toContain('maintenanceOpen=true')
  expect(settingsView).toContain("from './settings-backup'")
  expect(settingsView).toContain('exportChatGptSettings(props.settingsAdapter)')
  expect(settingsView).toContain('restoreChatGptSettings(props.settingsAdapter, settingsBackupFile.value)')
  expect(descriptor.template?.content).toContain('settingsBackupApproved')
  expect(descriptor.template?.content).toContain('Сохранить настройки')
  expect(descriptor.template?.content).toContain('Восстановить настройки')
  expect(settingsView).toContain('props.telemetryControlAdapter.test()')
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
  expect(panel).toContain('context?.fixedArchive')
  expect(panel).toContain('fixed.listCurrent()')
  expect(panel).toContain('fixed.exportCurrent()')
  expect(fixedView).toContain('contains_opaque')
  expect(panel).not.toContain('<ArchiveWorkspace')
})
