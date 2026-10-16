/** One language preference per product/channel installation, shared by its providers. */
export type ApplicationLanguagePreference = 'auto' | 'ru' | 'en'
export type ApplicationLocale = 'ru' | 'en'
export const APPLICATION_LOCALE = Symbol('application-locale')
export function isApplicationLanguage(value: unknown): value is ApplicationLanguagePreference {
  return value === 'auto' || value === 'ru' || value === 'en'
}
export function resolveApplicationLocale(
  preference: ApplicationLanguagePreference,
  languages: readonly string[] = typeof navigator === 'undefined'
    ? []
    : navigator.languages?.length
      ? navigator.languages
      : [navigator.language],
): ApplicationLocale {
  if (preference !== 'auto') return preference
  return languages.some((language) => language.toLowerCase().startsWith('ru')) ? 'ru' : 'en'
}
export interface ApplicationLocaleController {
  current(): ApplicationLanguagePreference
  subscribe(listener: () => void): () => void
}
