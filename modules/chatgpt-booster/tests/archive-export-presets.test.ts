import { expect, test } from 'bun:test'
import { DEFAULT_EXPORT_OPTIONS, type ArchiveExportFormatDescriptor } from '@chatgpt-booster/core'
import { archiveExportPresetOptions } from '../packages/ui/src/archive-export-presets'

const formats: ArchiveExportFormatDescriptor[] = [
  { id: 'markdown', label: 'Markdown', mimeType: 'text/markdown', fileExtension: 'md', isDefault: true },
  { id: 'json', label: 'JSON', mimeType: 'application/json', fileExtension: 'json', isDefault: false },
]

test('readable export preset strips only technical profile and unverified binaries', () => {
  const current = { ...DEFAULT_EXPORT_OPTIONS, level: 'full' as const, images: true, files: true }
  const next = archiveExportPresetOptions(current, 'markdown', formats, 4)
  expect(next).toMatchObject({ format: 'markdown', level: 'conversation', packaging: 'none', images: false, files: false })
  expect(current).toMatchObject({ level: 'full', images: true, files: true })
})

test('JSON profiles preserve full technical selection and separately choose output packaging', () => {
  const current = { ...DEFAULT_EXPORT_OPTIONS, level: 'custom' as const, sourceRevisions: true }
  for (const [preset, packaging] of [
    ['json', 'none'], ['json-gzip', 'gzip'], ['json-zip', 'zip'],
  ] as const) {
    const next = archiveExportPresetOptions(current, preset, formats, 4)
    expect(next).toMatchObject({ format: 'json', packaging, level: 'full', sourceRevisions: true, images: false, files: false })
  }
})

test('unsupported source formats and unsupported archive packaging are rejected without fallback', () => {
  expect(archiveExportPresetOptions(DEFAULT_EXPORT_OPTIONS, 'markdown', formats.slice(1), 4)).toBeNull()
  expect(archiveExportPresetOptions(DEFAULT_EXPORT_OPTIONS, 'json', formats.slice(0, 1), 4)).toBeNull()
  expect(archiveExportPresetOptions(DEFAULT_EXPORT_OPTIONS, 'json-gzip', formats, 3)).toBeNull()
  expect(archiveExportPresetOptions(DEFAULT_EXPORT_OPTIONS, 'json-zip', formats, 3)).toBeNull()
})
