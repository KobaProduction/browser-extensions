<script setup lang="ts">
import { type FeatureRuntime, flattenFeatureSettingsCategories } from '@kobaproduction/browser-core'
import {
  Badge,
  Button,
  SettingsCatalog,
  Switch,
  useApplicationLocale,
  useLocalizedText,
} from '@kobaproduction/browser-ui'
import { X } from 'lucide-vue-next'
import { type Component, computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ApplicationIdentity } from './application'
import ShellSettings from './ShellSettings.vue'
import {
  commonSettingsCategories,
  providerSettingsCategory,
  settingsCatalogGroups,
} from './settings-catalog'
import { SHELL_UI_MESSAGES } from './ui-messages'

const text = useLocalizedText(SHELL_UI_MESSAGES)

const props = defineProps<{
  runtime: FeatureRuntime
  views: Record<string, Component>
  title: string
  application: ApplicationIdentity
  selectedSection: string
  floating?: boolean
  siteEntryAvailable?: boolean
  settingsCategory?: string
}>()
const emit = defineEmits<{ close: []; select: [section: string]; category: [id: string] }>()
const locale = useApplicationLocale()
// The aggregate can register many features while only one matches this host.
// Keep the Shell's navigation policy aligned with Overlay.vue's active-site matching.
const matchingFeatures = computed(() =>
  props.runtime.features.filter((feature) => feature.match(props.runtime.context.url)),
)
const standalone = computed(() => matchingFeatures.value.length === 1)
const singleFeature = computed(() => (standalone.value ? matchingFeatures.value[0] : undefined))
const section = ref(props.selectedSection)
let navigationRevision = 0
let navigationQueue: Promise<void> = Promise.resolve()
function leaveView(id: string) {
  try {
    props.runtime.features.find((feature) => feature.id === id)?.presentation?.onViewHidden?.()
  } catch {}
}
watch(
  () => props.selectedSection,
  (value) => {
    if (section.value !== value) {
      navigationRevision++
      leaveView(section.value)
    }
    section.value = value
  },
)
const revision = ref(0)
let unsubscribe: (() => void) | undefined
let unsubscribeSettings: (() => void)[] = []
function bindSettingsPresentation() {
  for (const stop of unsubscribeSettings)
    try {
      stop()
    } catch {}
  unsubscribeSettings = []
  for (const feature of matchingFeatures.value) {
    try {
      const stop = feature.settings?.subscribe?.(() => {
        revision.value++
      })
      if (stop) unsubscribeSettings.push(stop)
    } catch {
      /* A provider's unavailable presentation cannot detach the catalog. */
    }
  }
}
onMounted(() => {
  bindSettingsPresentation()
  unsubscribe = props.runtime.subscribe(() => {
    revision.value++
    bindSettingsPresentation()
  })
})
onBeforeUnmount(() => {
  navigationRevision++
  leaveView(section.value)
  unsubscribe?.()
  for (const stop of unsubscribeSettings)
    try {
      stop()
    } catch {}
})
const statuses = computed(() => {
  void revision.value
  return props.runtime.list()
})
const installationActive = computed(() => {
  void revision.value
  return props.runtime.isRunning()
})
const changing = ref(false)
const changeError = ref('')
async function toggleInstallation() {
  if (changing.value) return
  changing.value = true
  changeError.value = ''
  try {
    await props.runtime.setRunning(!installationActive.value)
  } catch {
    changeError.value = 'Не удалось изменить состояние установки'
  } finally {
    changing.value = false
  }
}
const activeFeatures = computed(() => statuses.value.filter((s) => s.state === 'active'))
const currentView = computed(() => props.views[section.value])
const currentViewKey = computed(() => {
  void revision.value
  const feature = matchingFeatures.value.find((item) => item.id === section.value)
  const moduleId = feature?.presentation?.viewModuleId
  const module = moduleId
    ? props.runtime.moduleList().find((item) => item.featureId === feature?.id && item.id === moduleId)
    : undefined
  return `${section.value}:${module?.state ?? 'provider'}`
})
const commonCategory = computed(() => {
  const candidate =
    section.value === 'modules'
      ? 'modules'
      : section.value === 'analytics'
        ? 'telemetry'
        : props.settingsCategory
  return commonSettingsCategories(props.runtime, props.application).some((id) => id === candidate)
    ? (candidate ?? 'interface')
    : 'interface'
})
const catalogGroups = computed(() => {
  void revision.value
  return settingsCatalogGroups(props.runtime, props.application)
})
const selectedProviderCategory = ref<string | null>(null)
const catalogActiveGroup = computed(() => (currentView.value ? section.value : 'application'))
const catalogSelected = computed(() => {
  void revision.value
  if (!currentView.value) return commonCategory.value
  const feature = matchingFeatures.value.find((item) => item.id === section.value)
  const current = feature?.settings?.currentCategory?.()
  if (feature?.settings?.currentCategory)
    return current &&
      flattenFeatureSettingsCategories(feature.settings.categories).some((item) => item.id === current)
      ? `provider:${feature.id}:${current}`
      : ''
  const selected = selectedProviderCategory.value ?? props.settingsCategory
  return selected && providerSettingsCategory(props.runtime, selected)?.feature.id === section.value
    ? selected
    : ''
})
watch(
  catalogSelected,
  (id) => {
    const next = id || 'interface'
    if (next !== props.settingsCategory) emit('category', next)
  },
  { immediate: true },
)
function selectSection(id: string) {
  if (section.value !== id) leaveView(section.value)
  section.value = id
  emit('select', id)
}
function selectCategory(id: string) {
  if (id.startsWith('provider:')) {
    const provider = providerSettingsCategory(props.runtime, id)
    if (provider) void openProviderSettings(provider.feature.id, provider.categoryId)
    return
  }
  if (!commonSettingsCategories(props.runtime, props.application).some((category) => category === id))
    return
  navigationRevision++
  selectedProviderCategory.value = null
  selectSection('shell-settings')
  emit('category', id)
}
function openProviderSettings(featureId: string, categoryId?: string): Promise<void> {
  const generation = ++navigationRevision
  const task = navigationQueue.then(async () => {
    if (generation !== navigationRevision) return
    const feature = matchingFeatures.value.find((item) => item.id === featureId)
    if (!feature) return
    changeError.value = ''
    try {
      if (feature.settings) {
        const leaves = flattenFeatureSettingsCategories(feature.settings.categories)
        const selected = categoryId ?? leaves[0]?.id
        if (!selected || !leaves.some((item) => item.id === selected)) return
        if (props.views[featureId]) {
          // Embedded navigation belongs to the Shell. A provider's asynchronous
          // external open/reveal must not reopen an older route after a new click.
          if (!feature.settings.restoreCategory) throw Error('Safe embedded navigation unavailable')
          await feature.settings.restoreCategory(selected)
        } else await feature.settings.open(selected)
        if (generation !== navigationRevision) return
        selectedProviderCategory.value = `provider:${featureId}:${selected}`
        if (props.views[featureId]) selectSection(featureId)
        return
      }
      const action = feature.quickActions?.find((item) => item.id === 'settings')
      if (props.views[featureId]) throw Error('Provider has no settings presentation contract')
      if (action) await action.run()
      if (generation !== navigationRevision) return
      selectedProviderCategory.value = `provider:${featureId}:settings`
      if (props.views[featureId]) selectSection(featureId)
    } catch {
      if (generation === navigationRevision) changeError.value = 'Не удалось открыть настройки продукта'
    }
  })
  navigationQueue = task.catch(() => undefined)
  return task
}
</script>
<template>
  <section class="booster-control-center" :class="{ 'booster-control-standalone': standalone }" :lang="locale" :data-settings-category="catalogSelected">
    <header v-if="!floating" class="booster-control-header">
      <div v-if="!floating" class="booster-header-copy">
        <div class="flex items-center gap-2">
          <strong>{{ title }}</strong>
          <span v-if="application.version" class="booster-version">{{ application.version }}</span>
          <Badge v-if="!standalone" variant="outline">Browser Tools</Badge>
        </div>
        <p v-if="!standalone">{{ text('Модульные инструменты браузера') }}</p>
      </div>
      <div class="booster-header-actions">
        <Switch :model-value="installationActive" :disabled="changing"
          :aria-label="installationActive ? text('Отключить функции расширения') : text('Включить функции расширения')"
          @update:model-value="toggleInstallation" />
        <Badge v-if="!standalone" variant="secondary">{{activeFeatures.length}}{{ text(' активен') }}</Badge>
        <Button v-if="!floating" variant="ghost" size="icon" class="size-8" :title="text('Закрыть')" @click="emit('close')"><X class="size-4"/></Button>
      </div>
    </header>
    <SettingsCatalog class="border-b px-3 py-3" :groups="catalogGroups" :selected="catalogSelected" :active-group="catalogActiveGroup" @select="selectCategory" />
    <div class="booster-settings-layout booster-settings-layout-catalog">
      <main class="booster-settings-content">
        <p v-if="changeError" role="alert">{{ text(changeError) }}</p>
        <component :is="currentView" v-if="currentView" :key="currentViewKey"
          :installation="singleFeature?.presentation?.installation" :version="singleFeature?.presentation?.version" :show-catalog="false" :show-identity="false" />
        <ShellSettings v-else :runtime="runtime" :application="application" :selected-category="commonCategory" :site-entry-available="siteEntryAvailable ?? false" @category="selectCategory" @provider-settings="openProviderSettings" />
      </main>
    </div>
  </section>
</template>
