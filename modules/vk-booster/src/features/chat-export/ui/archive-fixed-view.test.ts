import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { compileTemplate, parse } from 'vue/compiler-sfc'

test('VK archive compiles and uses the fixed source ports and scoped preferences', () => {
  const text = readFileSync(new URL('./ArchivePanel.vue', import.meta.url), 'utf8')
  const { descriptor, errors } = parse(text, { filename: 'ArchivePanel.vue' })
  expect(errors).toHaveLength(0)
  const result = compileTemplate({
    source: descriptor.template?.content ?? '',
    filename: 'ArchivePanel.vue',
    id: 'vk-fixed-dexie',
  })
  expect(result.errors).toHaveLength(0)
  const adapter = readFileSync(new URL('../model/chat-collection-port.ts', import.meta.url), 'utf8')
  expect(adapter).toContain('api.captureFixed(')
  expect(text).toContain('collector.start()')
  // The strict durable settings validator does not accept ArchiveOptions.peerId.
  expect(text).not.toContain('...api.status().options')
  expect(text).toContain('const { mode, from, through, media } = api?.status().options')
  expect(text).toContain('limit: fixedLimit.value')
  expect(text).toContain('pageSize: requestPageSize.value')
  expect(text).toContain('delay: requestDelay.value')
  expect(text).toContain('api.readFixed(')
  expect(text).toContain('api.exportUserConversation(')
  expect(text).toContain('readerRevision !== savedRevision')
  expect(text).toContain('!fixedPreview.value.length')
  expect(text).toContain('<ArchiveMessageHeader')
  expect(text).toContain('<ArchiveRecordList')
  expect(text).toContain('<ArchiveReadingSurface')
  expect(text).toContain('<ArchiveTimeline')
  expect(text).toContain('useArchiveFocusTracker(')
  expect(text).not.toContain('<ArchiveManager')
  expect(text).toContain('vkPreferencesPersistence()')
  expect(text).toContain('await port.write(options)')
})

test('VK user export shares format/scope widgets and downloads attachments only through the explicit scoped port', () => {
  const source = readFileSync(new URL('./ArchivePanel.vue', import.meta.url), 'utf8')
  expect(source).toContain("captureRange === 'all'")
  expect(source).toContain("captureRange === 'recent'")
  expect(source).toContain('requestPageSize')
  expect(source).toContain('requestDelay')
  expect(source).toContain('!hasVerifiedPeer')
  expect(source).toContain('vkRequestedView.value = null')
  expect(source).toContain('document.body.append(link)')
  expect(source).toContain('link.remove()')
  expect(source).toContain('vkArchiveErrorMessage(error)')
  expect(source).toContain('<ArchiveExportFormatFields')
  expect(source).toContain('<ArchiveSelectionScope')
  expect(source).toContain('<ArchiveProgressBar')
  expect(source).toContain('async function prepareUserExport()')
  expect(source).toContain('function downloadPreparedExport()')
  expect(source).toContain('result.blob')
  expect(source).toContain('result.extension')
  expect(source).toContain("includeMedia: exportPackaging.value === 'zip' && exportIncludeMedia.value")
  expect(source).toContain("if (requested === 'export') {")
  expect(source).toContain('showUserExportOptions()')
  expect(source).not.toContain('void exportDexie()')
  expect(source).toMatch(
    /api\.downloadAttachmentFixed\(\s*messageId,\s*asset\.key,\s*request\.signal\s*\)/,
  )
  expect(source).not.toMatch(/\bfetch\s*\(/)
  expect(source).not.toContain('readArchiveMedia(')
})
