/** Flat attachment naming: numeric stable prefix, hyphen, readable original name. */
export function safeAttachmentName(name: string, maxBytes = 160): string {
  let safe =
    name
      .normalize('NFC')
      .replace(/[\\/:*?"<>|\p{Cc}]/gu, '_')
      .replace(/^\.+/, '_')
      .replace(/[. ]+$/, '')
      .trim() || 'file.bin'
  const dot = safe.lastIndexOf('.')
  const extension = dot > 0 ? safe.slice(dot).slice(0, 18) : ''
  const head = extension ? safe.slice(0, dot) : safe
  let output = ''
  const budget = Math.max(16, maxBytes - new TextEncoder().encode(extension).byteLength)
  for (const ch of head) {
    if (new TextEncoder().encode(output + ch).byteLength > budget) break
    output += ch
  }
  safe = (output || 'file') + extension
  return safe
}
export function attachmentFilename(messageId: number, index: number, original: string): string {
  if (
    !Number.isSafeInteger(messageId) ||
    messageId <= 0 ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= 10000
  )
    throw Error('Invalid attachment identity')
  // 4 decimal digits for per-message index; never a collision across messages.
  const prefix = messageId + String(index + 1).padStart(4, '0')
  return prefix + '-' + safeAttachmentName(original, 180 - prefix.length - 1)
}
