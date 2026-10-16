import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { compileTemplate, parse } from 'vue/compiler-sfc'
import { vkActiveView, vkRequestedView } from '../src/features/chat-export/model/ui-navigation'
import { vkBoosterFeature } from '../src/index'

const panel = readFileSync(
  new URL('../src/features/chat-export/ui/ArchivePanel.vue', import.meta.url),
  'utf8',
)
const reader = readFileSync(
  new URL('../src/features/chat-export/ui/ArchivePreview.vue', import.meta.url),
  'utf8',
)

test('VK hosted view reuses the shell and keeps local registry navigation optional', () => {
  const { descriptor, errors } = parse(panel, { filename: 'ArchivePanel.vue' })
  expect(errors).toHaveLength(0)
  expect(descriptor.scriptSetup).toBeTruthy()
  const compiled = compileTemplate({
    source: descriptor.template?.content ?? '',
    filename: 'ArchivePanel.vue',
    id: 'vk-v1-tabs',
  })
  expect(compiled.errors).toHaveLength(0)
  expect(descriptor.template?.content).toContain('<TabsList')
  expect(descriptor.template?.content).toContain('v-if="showCatalog !== false"')
  expect(descriptor.template?.content).toContain('<TabsContent')
  expect(descriptor.template?.content).toContain('<TabsTrigger')
  expect(panel).not.toContain('onTabKeydown')
  expect(panel).not.toMatch(/<button[\s>]/)
  expect(panel).not.toContain('<BoosterOverlay')
  expect(panel).not.toContain('<ArchiveWorkspace')
  expect(vkBoosterFeature.id).toBe('vk-booster')
})

test('all three VK views are direct safe catalog routes and restore only presentation state', () => {
  const settings = vkBoosterFeature.settings
  if (!settings) throw Error('VK settings contribution is required')
  expect(settings.categories.map((category) => category.id)).toEqual(['capture', 'reader', 'settings'])
  expect(settings.categories.every((category) => !category.children?.length)).toBe(true)
  const previous = vkActiveView.value
  const instruction = vkRequestedView.value
  try {
    vkRequestedView.value = null
    for (const view of ['capture', 'reader', 'settings'] as const) {
      settings.restoreCategory?.(view)
      expect(settings.currentCategory?.()).toBe(view)
      expect(vkActiveView.value).toBe(view)
      expect(vkRequestedView.value).toBeNull()
    }
    for (const invalid of ['archive', 'collect', 'export', 'other', '../reader', '']) {
      settings.restoreCategory?.(invalid)
      expect(settings.currentCategory?.()).toBe('settings')
      expect(vkRequestedView.value).toBeNull()
    }
  } finally {
    vkActiveView.value = previous
    vkRequestedView.value = instruction
  }
})

test('explicit catalog opens publish one safe view instruction and invalid routes publish none', () => {
  const settings = vkBoosterFeature.settings
  if (!settings) throw Error('VK settings contribution is required')
  const previous = vkActiveView.value
  const instruction = vkRequestedView.value
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const events: Event[] = []
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dispatchEvent: (event: Event) => {
        events.push(event)
        return true
      },
    },
  })
  try {
    vkActiveView.value = 'settings'
    for (const view of ['capture', 'reader', 'settings'] as const) {
      vkRequestedView.value = null
      const before = events.length
      settings.open(view)
      expect(vkRequestedView.value).toBe(view)
      expect(events.length).toBe(before + 1)
      const event = events.at(-1)
      if (!(event instanceof CustomEvent)) throw Error('A provider open event is required')
      expect(event.detail.id).toBe('vk-booster')
      // Opening a view never starts a collection/export or changes the host's
      // currently rendered view before the mounted provider consumes it.
      expect(vkActiveView.value).toBe('settings')
    }
    vkRequestedView.value = null
    const count = events.length
    for (const invalid of ['collect', 'export', 'other', '../reader', '']) settings.open(invalid)
    expect(vkRequestedView.value).toBeNull()
    expect(events).toHaveLength(count)
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor)
    else Reflect.deleteProperty(globalThis, 'window')
    vkActiveView.value = previous
    vkRequestedView.value = instruction
  }
})

test('capture and reader use only fixed Dexie and hide the historical folder writer', () => {
  expect(panel).toContain('<TabsContent value="capture"')
  expect(panel).toContain('<ConversationCollectionAction')
  expect(panel).toContain('collector.start()')
  expect(panel).toContain("requested === 'collect'")
  expect(panel).toContain('api.readFixed(80, cursor)')
  expect(panel).toContain('api.exportUserConversation(')
  expect(panel).toContain('showUserExportOptions()')
  expect(panel).not.toContain('void exportDexie()')
  expect(panel).not.toContain('<ArchiveManager')
  expect(panel).not.toContain('api?.run(')
  expect(panel).not.toContain('chooseFolder')
  expect(panel).toContain('fixedPreview.value = []')
  expect(panel).toContain('role="alert"')
  expect(panel).toContain('fixedNextCursor')
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
  expect(panel).toContain('<TabsContent value="settings"')
  expect(panel).not.toContain('exportVkCaptureSettings(api)')
  expect(panel).not.toContain('restoreVkCaptureSettings(')
  expect(panel).toContain('vkPreferencesPersistence()')
  expect(panel).toContain('await port.write(options)')
  expect(panel).not.toContain('preferencesConfirmed')
  expect(panel).toContain('durableSettingsError')
  expect(panel).not.toContain('<PortableBackupPanel')
  expect(panel).not.toContain('api.backupPortable(')
  expect(panel).not.toContain('api.restorePortable(')
  expect(panel).not.toContain('restoreCanonicalBackup')
})
