/** Remove UI-generated duplicate headings without changing archived source records. */
export function omitRepeatedRecordHeading(text: string, heading: string): string {
  const trimmed = text.trim()
  if (!trimmed || !heading.trim()) return trimmed
  const lines = trimmed.split(/\r?\n/)
  const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
  if (normalize(lines[0] ?? '') === normalize(heading)) return lines.slice(1).join('\n').trim()
  return trimmed
}

export function parseArchiveStructuredText(text: string): unknown | null {
  const trimmed = text.trim()
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}
