/**
 * Presentation-only text for the small Archive History navigator.
 *
 * Source text, raw message metadata, and exports are never modified.
 * Keep content words, but omit opaque attachment identifiers and common
 * Markdown/rendering markup that is meaningless outside the original message.
 */
export function archiveHistoryPreview(source: string, locale: 'ru' | 'en'): string {
  const imageLabel = locale === 'ru' ? 'Изображение' : 'Image'
  const fileLabel = locale === 'ru' ? 'Вложение' : 'Attachment'
  const result = source
    .replace(/\[image_asset_pointer\]\s*(?:sediment:\/\/\S+)?/gi, ` ${imageLabel} · `)
    .replace(/\[(?:file|attachment)_asset_pointer\]\s*(?:sediment:\/\/\S+)?/gi, ` ${fileLabel} · `)
    .replace(/\bsediment:\/\/\S+/gi, '')
    .replace(/cite[^]*/g, '')
    .replace(/!\[([^\]]*)\]\([^\n)]*\)/g, (_, name: string) => name || imageLabel)
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^\s)]*(?:\s+"[^"]*")?\)/g, '$1')
    .replace(/^(?:\s{0,3}#{1,6}\s+|\s{0,3}>\s*)/gm, '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(?<!\w)[*_]([^*_\n]+)[*_](?!\w)/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/[\r\n\t ]+/g, ' ')
    .trim()
  return result.slice(0, 180)
}
