<script setup lang="ts">
import {
  type FeatureRuntime,
  isApplicationLanguage,
  type ShellPreferences,
} from '@kobaproduction/browser-core'
import {
  Button,
  Card,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingRow,
  Switch,
  useApplicationLocale,
} from '@kobaproduction/browser-ui'
import { ApplicationBackupSettings, ApplicationTelemetrySettings } from '@kobaproduction/browser-widgets'
import { computed, onBeforeUnmount, ref, useId } from 'vue'
import type { ApplicationIdentity } from './application'
import { commonSettingsCategories, hasProductManagement } from './settings-catalog'

const props = defineProps<{
  runtime: FeatureRuntime
  application: ApplicationIdentity
  siteEntryAvailable: boolean
  selectedCategory?: string
}>()
const emit = defineEmits<{
  providerSettings: [featureId: string, categoryId?: string]
  category: [id: string]
}>()
const id = useId()
const locale = useApplicationLocale()
const text = (ru: string, en: string) => (locale.value === 'ru' ? ru : en)
const revision = ref(0)
const unsubscribe = props.runtime.subscribe(() => {
  revision.value++
})
onBeforeUnmount(unsubscribe)
const preferences = computed(() => {
  void revision.value
  return props.runtime.shellPreferences()
})
const statuses = computed(() => {
  void revision.value
  return props.runtime.list()
})
const capabilities = computed(() => {
  void revision.value
  return props.runtime.moduleList()
})
const hasComponents = computed(() => (props.application.components?.length ?? 0) > 1)
const productManagement = computed(() => hasProductManagement(props.runtime, props.application))
const category = computed(() => {
  const value = props.selectedCategory
  return value && commonSettingsCategories(props.runtime, props.application).some((id) => id === value)
    ? value
    : 'interface'
})
const busy = ref(false)
const error = ref('')
async function update(task: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await task()
  } catch {
    error.value = text('Не удалось сохранить настройку', 'Could not save the preference')
  } finally {
    busy.value = false
  }
}
function change(key: Exclude<keyof ShellPreferences, 'language'>, checked: boolean) {
  void update(() => props.runtime.setShellPreferences({ [key]: checked }))
}
function changeLanguage(value: unknown) {
  if (isApplicationLanguage(value))
    void update(() => props.runtime.setShellPreferences({ language: value }))
}
function toggleFeature(featureId: string, enabled: boolean) {
  void update(() => props.runtime.setEnabled(featureId, enabled))
}
function toggleCapability(featureId: string, moduleId: string, checked: boolean) {
  void update(() => props.runtime.setModuleEnabled(featureId, moduleId, checked))
}
</script>

<template>
  <section class="booster-shell-settings" data-shell-settings :data-shell-category="category">
    <div class="booster-shell-settings-body">
      <p v-if="error" role="alert">{{ error }}</p>
      <template v-if="category === 'interface'">
        <h2>{{ text('Интерфейс и отображение','Interface and display') }}</h2>
        <Card class="grid min-w-0 gap-3 p-3 min-[621px]:grid-cols-[minmax(0,1fr)_minmax(180px,280px)] min-[621px]:items-center">
          <div class="min-w-0 space-y-1">
            <Label :for="`${id}-language`">{{ text('Язык приложения','Application language') }}</Label>
            <p :id="`${id}-language-description`" class="text-xs text-muted-foreground">{{ text('Один выбор языка для всего приложения.','One language preference for the entire application.') }}</p>
          </div>
          <Select :model-value="preferences.language" :disabled="busy" @update:model-value="changeLanguage">
            <SelectTrigger :id="`${id}-language`" :aria-describedby="`${id}-language-description`"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="auto">{{ text('Системный','System default') }}</SelectItem><SelectItem value="ru">Русский</SelectItem><SelectItem value="en">English</SelectItem></SelectContent>
          </Select>
        </Card>
        <div class="grid min-w-0 gap-3 min-[1024px]:grid-cols-2">
          <SettingRow :id="`${id}-launcher`" :title="text('Показывать каплю','Show launcher')" :description="text('Оторвите от края, переместите и прикрепите снова.','Detach from the edge, move and dock it again.')" :model-value="preferences.launcher" :disabled="busy" @update:model-value="change('launcher', $event)" />
          <SettingRow :id="`${id}-quick`" :title="text('Быстрое меню','Quick menu')" :description="text('По нажатию капли. Если выключено, сразу открываются настройки.','Opened by the launcher. When disabled, the launcher opens settings.')" :model-value="preferences.quickMenu" :disabled="busy" @update:model-value="change('quickMenu', $event)" />
          <SettingRow :id="`${id}-metrics`" :title="text('Сводка в меню','Menu summary')" :description="text('Счётчики текущего контекста, если их предоставляет модуль.','Current-context counters supplied by the feature.')" :model-value="preferences.metrics" :disabled="busy" @update:model-value="change('metrics', $event)" />
          <SettingRow :id="`${id}-site`" :title="text('Browser Tools на сайте','Browser Tools on the site')" :description="text('Вход в меню и настройки из шапки сайта.','Open the menu and settings from the site header.')" :model-value="preferences.siteEntry" :disabled="busy" @update:model-value="change('siteEntry', $event)" />
        </div>
        <p v-if="preferences.siteEntry && !siteEntryAvailable" role="status">{{ text('Шапка сайта пока недоступна. Меню и настройки можно открыть через расширение браузера или Tampermonkey.','The site header is unavailable. Open the menu and settings through the extension or Tampermonkey.') }}</p>
        <p>{{ text('Скрытие капли и меню сохраняет работу модулей и доступ к настройкам.','Hiding the launcher and menu preserves feature operation and access to settings.') }}</p>
      </template>
      <template v-else-if="category === 'modules' && productManagement">
        <h2>{{ text('Модули и интеграции','Modules and integrations') }}</h2>
        <p>{{ text('Продукт предоставляет доступные на этом сайте возможности. Каждая возможность управляется отдельно.','Products provide the features available on this site. Each feature is managed separately.') }}</p>
        <section v-for="feature in statuses" :key="feature.id" class="booster-capability-group">
          <Card class="flex flex-row items-center justify-between gap-4 p-3"><span class="booster-setting-copy"><b>{{ locale === 'en' ? feature.titleEn ?? feature.title : feature.title }}</b><span>{{ locale === 'en' ? feature.descriptionEn ?? feature.description : feature.description }}</span><small v-if="feature.state === 'unsupported'">{{ text('Недоступно на этой странице', 'Unavailable on this page') }}</small></span><Switch :model-value="feature.state === 'active'" :disabled="busy || !runtime.isRunning() || feature.state === 'unsupported'" :aria-label="`${text('Включить', 'Enable')} ${locale === 'en' ? feature.titleEn ?? feature.title : feature.title}`" @update:model-value="toggleFeature(feature.id, $event)" /></Card>
          <Card v-for="module in capabilities.filter((item) => item.featureId === feature.id)" :key="module.id" class="booster-capability-row flex flex-row items-center justify-between gap-4 p-3"><span class="booster-setting-copy"><b>{{ locale === 'en' ? module.titleEn ?? module.title : module.title }}</b><span>{{ locale === 'en' ? module.descriptionEn ?? module.description : module.description }}</span><small v-if="module.state === 'unsupported'">{{ text('В этом контексте недоступно', 'Unavailable in this context') }}</small><small v-else-if="module.state === 'failed'">{{ text('Не удалось запустить. Можно выключить и включить повторно.', 'Could not start. Disable and enable to retry.') }}</small><small v-else-if="module.enabled && feature.state !== 'active'">{{ text('Запустится после включения продукта', 'Starts when the product is enabled') }}</small></span><div class="booster-header-actions"><Button v-if="module.settingsCategory" type="button" variant="outline" size="sm" @click="emit('providerSettings', feature.id, module.settingsCategory)">{{ text('Настроить', 'Configure') }}</Button><Switch :model-value="module.enabled" :disabled="busy" :aria-label="`${text('Включить', 'Enable')} ${locale === 'en' ? module.titleEn ?? module.title : module.title}`" @update:model-value="toggleCapability(feature.id, module.id, $event)" /></div></Card>
          <Button v-if="feature.state !== 'unsupported'" type="button" variant="outline" size="sm" @click="emit('providerSettings', feature.id)">{{ text('Настройки', 'Settings') }} {{ locale === 'en' ? feature.titleEn ?? feature.title : feature.title }}</Button>
        </section>
      </template>
      <ApplicationTelemetrySettings v-else-if="category === 'telemetry'" />
      <ApplicationBackupSettings v-else-if="category === 'backup'" />
      <template v-else-if="category === 'about' && hasComponents">
        <h2>{{ text('Состав приложения','Application components') }}</h2>
        <p v-if="application.installation">{{ text('Способ установки:','Installation method:') }} {{ application.installation }}</p>
        <dl class="booster-component-versions"><template v-for="component in application.components" :key="component.id"><dt>{{ component.title }}</dt><dd>{{ component.version }}</dd></template></dl>
      </template>
    </div>
  </section>
</template>
