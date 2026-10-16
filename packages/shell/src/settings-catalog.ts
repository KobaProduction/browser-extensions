import {
  type FeatureRuntime,
  type FeatureSettingsCategory,
  flattenFeatureSettingsCategories,
  resolveApplicationLocale,
} from '@kobaproduction/browser-core'
import type { SettingsCatalogEntry, SettingsCatalogGroup } from '@kobaproduction/browser-ui'
import type { ApplicationIdentity } from './application'
export const COMMON_SETTINGS_CATEGORIES = [
  'interface',
  'modules',
  'telemetry',
  'backup',
  'about',
] as const
/** Application composition, not the current host match, owns product management. */
export function hasProductManagement(
  runtime: FeatureRuntime,
  application: ApplicationIdentity,
): boolean {
  return runtime.features.length > 1 || runtime.features[0]?.id !== application.id
}
export function commonSettingsCategories(runtime: FeatureRuntime, application: ApplicationIdentity) {
  return COMMON_SETTINGS_CATEGORIES.filter(
    (id) =>
      (id !== 'modules' || hasProductManagement(runtime, application)) &&
      (id !== 'about' || (application.components?.length ?? 0) > 1),
  )
}
/** Catalog IDs are accepted only when declared by a provider matching this host. */
export function providerSettingsCategory(runtime: FeatureRuntime, id: string) {
  const parts = id.split(':')
  if (parts.length !== 3 || parts[0] !== 'provider') return undefined
  const feature = runtime.features.find(
    (item) => item.id === parts[1] && item.match(runtime.context.url),
  )
  const categoryId = parts[2]
  if (
    !feature ||
    !categoryId ||
    !(feature.settings
      ? flattenFeatureSettingsCategories(feature.settings.categories).some(
          (item) => item.id === categoryId,
        )
      : categoryId === 'settings')
  )
    return undefined
  return { feature, categoryId }
}
function providerCategoryTree(
  featureId: string,
  categories: readonly FeatureSettingsCategory[],
  english: boolean,
): readonly SettingsCatalogEntry[] {
  return categories.map(({ id, title, titleEn, description, descriptionEn, children }) => ({
    id: `provider:${featureId}:${id}`,
    title: english ? (titleEn ?? title) : title,
    description: english ? (descriptionEn ?? description) : description,
    ...(children?.length ? { children: providerCategoryTree(featureId, children, english) } : {}),
  }))
}
export function validSettingsCatalogId(runtime: FeatureRuntime, id: string): boolean {
  return (
    COMMON_SETTINGS_CATEGORIES.some((item) => item === id) ||
    providerSettingsCategory(runtime, id) !== undefined
  )
}
/** One catalog owns app and provider navigation; providers contribute metadata only. */
export function settingsCatalogGroups(
  runtime: FeatureRuntime,
  application: ApplicationIdentity,
): readonly SettingsCatalogGroup[] {
  const locale = resolveApplicationLocale(runtime.shellPreferences().language)
  const text = (ru: string, en: string) => (locale === 'ru' ? ru : en)
  const providers = runtime.features
    .filter((feature) => feature.match(runtime.context.url))
    .map((feature) => ({
      id: feature.id,
      title:
        (application.components?.length ?? 0) > 1 || application.id !== feature.id
          ? locale === 'en'
            ? (feature.titleEn ?? feature.title)
            : feature.title
          : text('Возможности', 'Features'),
      entries: feature.settings
        ? providerCategoryTree(feature.id, feature.settings.categories, locale === 'en')
        : [
            {
              id: `provider:${feature.id}:settings`,
              title: text('Настройки продукта', 'Product settings'),
            },
          ],
    }))
  return [
    ...providers,
    {
      id: 'application',
      title: text('Общие настройки', 'General'),
      entries: [
        { id: 'interface', title: text('Интерфейс и отображение', 'Interface and display') },
        ...(hasProductManagement(runtime, application)
          ? [{ id: 'modules', title: text('Модули и интеграции', 'Modules and integrations') }]
          : []),
        { id: 'telemetry', title: text('Телеметрия и диагностика', 'Telemetry and diagnostics') },
        { id: 'backup', title: text('Резервные копии', 'Backups') },
        ...((application.components?.length ?? 0) > 1
          ? [{ id: 'about', title: text('Состав приложения', 'Application components') }]
          : []),
      ],
    },
  ]
}
