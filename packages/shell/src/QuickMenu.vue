<script setup lang="ts">
import type { FeatureQuickAction, FeatureQuickMetric } from '@kobaproduction/browser-core'
import { Archive, ArrowUpToLine, Download, FolderOpen, Settings2, ShieldCheck, X } from 'lucide-vue-next'
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  title: string
  version?: string
  installation?: string
  active: boolean
  enabled: boolean
  busy: boolean
  actions: readonly FeatureQuickAction[]
  metrics?: readonly FeatureQuickMetric[]
}>()
const emit = defineEmits<{ close: []; select: [id: string]; toggle: []; resize: [height: number] }>()
const root = ref<HTMLElement | null>(null)
let observer: ResizeObserver | undefined
onMounted(() => {
  if (typeof ResizeObserver !== 'function' || !root.value) return
  observer = new ResizeObserver(() => {
    if (root.value) emit('resize', root.value.getBoundingClientRect().height)
  })
  observer.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())
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
  <section ref="root" class="booster-quick-menu" role="dialog" :aria-label="`${title}: быстрое меню`">
    <header class="booster-quick-header">
      <div class="booster-quick-identity">
        <strong>{{ title }}</strong>
        <div class="booster-quick-badges">
          <span v-if="installation">{{ installation }}</span>
          <span v-if="version">{{ version }}</span>
        </div>
      </div>
      <button class="booster-quick-close" type="button" aria-label="Закрыть меню" @click="emit('close')"><X class="size-4" /></button>
    </header>
    <div v-if="metrics?.length" class="booster-quick-metrics" aria-label="Сводка модуля">
      <div v-for="metric in metrics" :key="metric.label"><span>{{ metric.label }}</span><b>{{ metric.value }}</b></div>
    </div>
    <div class="booster-quick-actions">
      <button v-for="action in actions" :key="action.id" type="button"
        :disabled="busy || (!active && !action.availableWhenDisabled) || (action.enabled && !action.enabled())" @click="emit('select', action.id)">
        <component :is="icons[action.icon || 'open']" class="size-4" aria-hidden="true" />
        <span>{{ action.label }}</span>
      </button>
    </div>
    <footer class="booster-quick-footer">
      <span class="booster-quick-status" :class="{ 'is-active': active }">{{ active ? 'Работает' : 'Выключен' }}</span>
      <button type="button" class="booster-quick-toggle" role="switch" :aria-checked="enabled"
        :aria-label="enabled ? 'Выключить Booster' : 'Включить Booster'" :disabled="busy" @click="emit('toggle')">
        <span />
      </button>
    </footer>
  </section>
</template>
