import { useApplicationLocale } from './application-locale'

/** Translate UI-owned captions, never conversation content or user-entered labels. */
export function useLocalizedText(messages: Readonly<Record<string, string>>) {
  const locale = useApplicationLocale()
  return (caption: string) => {
    if (locale.value === 'ru') return caption
    const trimmed = caption.trim()
    const translated = messages[trimmed]
    return translated === undefined ? caption : caption.replace(trimmed, translated)
  }
}
