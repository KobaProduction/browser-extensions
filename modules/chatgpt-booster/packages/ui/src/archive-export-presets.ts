import type { ArchiveExportFormatDescriptor, ArchiveExportOptions } from '@chatgpt-booster/core'

export type ArchiveExportPreset = 'markdown' | 'json' | 'json-gzip' | 'json-zip'

/** A format shortcut only selects existing archive exporter capabilities.
 * It does not bypass owner, source, completeness or attachment checks. */
export function archiveExportPresetOptions(
  current: ArchiveExportOptions,
  preset: ArchiveExportPreset,
  formats: readonly ArchiveExportFormatDescriptor[],
  archiveGeneration: number,
): ArchiveExportOptions | null {
  const format = preset === 'markdown' ? 'markdown' : 'json'
  if (!formats.some((available) => available.id === format)) return null
  if ((preset === 'json-gzip' || preset === 'json-zip') && archiveGeneration !== 4) return null
  const packaging = preset === 'json-gzip' ? 'gzip' : preset === 'json-zip' ? 'zip' : 'none'
  // Readable Markdown is a conversation-only document; full native source
  // and provenance need JSON. No preset promises attachment binary bytes.
  return {
    ...current,
    format,
    packaging,
    level: preset === 'markdown' ? 'conversation' : 'full',
    images: false,
    files: false,
  }
}
