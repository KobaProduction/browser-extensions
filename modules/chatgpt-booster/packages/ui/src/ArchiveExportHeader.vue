<script setup lang="ts">
import type { ArchiveExportProgress } from '@chatgpt-booster/core'
import { ArchiveProgress, Button, TooltipHint } from '@kobaproduction/browser-ui'
import { ArrowLeft, Download } from 'lucide-vue-next'
import { computed } from 'vue'
import { type SupportedLocale, type TranslationKey, translate } from './i18n'

const props = defineProps<{
  locale: SupportedLocale
  title?: string | null | undefined
  ready: boolean
  busy: boolean
  showPrepare: boolean
  prepareDisabled: boolean
  prepareBlocked: boolean
  preparedUrl: string
  preparedName: string
  preparedBytes: number | null
  exportProgress: Readonly<ArchiveExportProgress> | null
  errorLabel: string
  exportCancelled: boolean
  complete: boolean
  incomplete: boolean
}>()
const emit = defineEmits<{ back: []; cancel: []; prepare: [] }>()
const t = (key: TranslationKey) => translate(props.locale, key)
const exportPhaseKeys: Record<ArchiveExportProgress['phase'], TranslationKey> = {
  checking: 'export.phaseChecking',
  reading: 'export.phaseReading',
  tracing: 'export.phaseTracing',
  serializing: 'export.phaseSerializing',
  packaging: 'export.phasePackaging',
  verifying: 'export.phaseVerifying',
  ready: 'export.phaseReady',
}
const exportPhaseLabel = computed(() =>
  props.exportProgress ? t(exportPhaseKeys[props.exportProgress.phase]) : t('export.working'),
)
function formatExportBytes(value: number): string {
  const scale = value >= 1024 * 1024 ? 1024 * 1024 : value >= 1024 ? 1024 : 1
  const label = scale === 1 ? t('export.progressBytes') : scale === 1024 ? 'KiB' : 'MiB'
  const number = new Intl.NumberFormat(props.locale, { maximumFractionDigits: scale === 1 ? 0 : 1 })
  return `${number.format(value / scale)} ${label}`
}
const exportCounter = computed(() => {
  const progress = props.exportProgress
  if (!progress || progress.completed === null) return ''
  if (progress.unit === 'bytes')
    return `${formatExportBytes(progress.completed)} / ${formatExportBytes(progress.total)}`
  const number = new Intl.NumberFormat(props.locale)
  const count =
    progress.total === null
      ? number.format(progress.completed)
      : `${number.format(progress.completed)} / ${number.format(progress.total)}`
  return `${count} ${t('export.progressRecords')}`
})
</script>

<template>
  <header class="booster-section-header">
    <Button variant="ghost" size="sm" type="button" @click="emit('back')"><ArrowLeft class="size-4" />{{ locale === 'ru' ? 'Назад' : 'Back' }}</Button>
    <div class="booster-export-heading">
      <strong>{{ t('export.title') }}</strong>
      <TooltipHint v-if="title" :label="title"><p>{{ title }}</p></TooltipHint>
      <p v-else>{{ t('identity.untitled') }}</p>
    </div>
    <div v-if="ready" class="booster-export-action">
      <Button v-if="busy" variant="outline" class="booster-action-secondary" type="button" @click="emit('cancel')">{{ locale === 'ru' ? 'Остановить экспорт' : 'Stop export' }}</Button>
      <Button v-else-if="preparedUrl" as-child variant="default" class="booster-export-ready" :disabled="prepareBlocked"><a :href="prepareBlocked ? undefined : preparedUrl" :aria-disabled="prepareBlocked" :tabindex="prepareBlocked ? -1 : undefined" :download="preparedName" @click="prepareBlocked && $event.preventDefault()"><Download class="size-4" />{{ t('export.readyDownload') }}</a></Button>
      <Button v-else-if="showPrepare" variant="default" class="booster-action-primary" type="button" :disabled="prepareDisabled" @click="emit('prepare')"><Download class="size-4" />{{ t('export.prepare') }}</Button>
    </div>
    <div v-if="ready" class="booster-export-feedback">
      <div class="booster-export-feedback-copy" role="status" aria-live="polite">
        <template v-if="busy">
          <span>{{ exportPhaseLabel }}</span>
          <small v-if="exportCounter">{{ exportCounter }}</small>
        </template>
        <span v-else-if="errorLabel" class="text-destructive">{{ errorLabel }}</span>
        <span v-else-if="exportCancelled">{{ locale === 'ru' ? 'Экспорт остановлен' : 'Export stopped' }}</span>
        <span v-else-if="complete">{{ t(incomplete ? 'export.savedPartial' : 'export.saved') }}</span>
        <small v-if="preparedUrl && preparedBytes !== null">{{ formatExportBytes(preparedBytes) }}</small>
      </div>
      <ArchiveProgress v-if="busy && exportProgress" compact class="booster-export-header-progress" :aria-label="exportPhaseLabel"
        :label="exportPhaseLabel" :busy="busy" :completed="exportProgress.completed" :total="exportProgress.total" />
    </div>
  </header>
</template>
