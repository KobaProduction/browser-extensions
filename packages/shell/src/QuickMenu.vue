<script setup lang="ts">
import type {
  FeatureIndicator,
  FeatureQuickAction,
  FeatureQuickMetric,
} from '@kobaproduction/browser-core'
import { Button, Switch, useApplicationLocale } from '@kobaproduction/browser-ui'
import { Archive, ArrowUpToLine, Download, FolderOpen, Settings2, ShieldCheck } from 'lucide-vue-next'
import LauncherIndicators from './LauncherIndicators.vue'

const props = defineProps<{
  title: string
  version?: string
  contextTitle?: string
  active: boolean
  enabled: boolean
  busy: boolean
  actions: readonly FeatureQuickAction[]
  metrics?: readonly FeatureQuickMetric[]
  indicators?: readonly FeatureIndicator[]
}>()
const emit = defineEmits<{ select: [id: string]; toggle: [] }>()
const locale = useApplicationLocale()
const text = (ru: string, en: string) => (locale.value === 'ru' ? ru : en)
const icons = {
  archive: Archive,
  collect: ArrowUpToLine,
  export: Download,
  settings: Settings2,
  capture: ShieldCheck,
  open: FolderOpen,
}
</script>

<template>
  <section class="booster-quick-menu">
    <header class="booster-quick-header">
      <div class="booster-quick-identity">
        <strong>{{ title }}</strong>
        <span v-if="version" class="booster-version">{{ version }}</span>
        <span v-if="contextTitle && contextTitle !== title" class="booster-quick-context">{{ contextTitle }}</span>
      </div>
      <Switch :model-value="enabled"
        :aria-label="`${enabled ? text('Выключить', 'Disable') : text('Включить', 'Enable')} ${title}`"
        :title="active ? text('Работает', 'Running') : enabled ? text('Включено, модуль недоступен на этой странице', 'Enabled; unavailable on this page') : text('Выключено', 'Disabled')"
        :disabled="busy" @update:model-value="emit('toggle')" />
    </header>
    <LauncherIndicators v-if="indicators?.length" :indicators="indicators" />
    <div v-if="metrics?.length" class="booster-quick-metrics" :aria-label="text('Сводка модуля', 'Module summary')">
      <div v-for="metric in metrics" :key="metric.label"><span>{{ locale === 'en' ? metric.labelEn ?? metric.label : metric.label }}</span><b>{{ metric.value }}</b></div>
    </div>
    <div class="booster-quick-actions">
      <Button v-for="action in actions" :key="action.id" type="button" variant="ghost" size="sm" class="h-auto min-h-8 w-full justify-start whitespace-normal rounded-none text-left"
        :data-quick-action="action.id"
        :disabled="busy || (!active && !action.availableWhenDisabled) || (action.enabled && !action.enabled())" @click="emit('select', action.id)">
        <component :is="icons[action.icon || 'open']" class="size-4" aria-hidden="true" />
        <span>{{ locale === 'en' ? action.labelEn ?? action.label : action.label }}</span>
      </Button>
    </div>
  </section>
</template>
