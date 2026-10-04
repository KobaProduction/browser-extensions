<script setup lang="ts">
import {
  DEFAULT_EXPORT_OPTIONS,
  normalizeExportOptions,
  type ArchiveExportFormatDescriptor,
  type ArchiveExportOptions,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import { ArrowUpToLine, CheckCircle2, Download, Info, X } from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { translate, type SupportedLocale, type TranslationKey } from './i18n'
import type { ArchiveCoverageView, ArchiveDataAdapter } from './mount'
const props = defineProps<{ archiveAdapter: ArchiveDataAdapter; settingsAdapter: SettingsAdapter; conversationId: string; title?: string | null; locale: SupportedLocale }>()
const emit = defineEmits<{ close: [] }>()
const options = ref<ArchiveExportOptions>({ ...DEFAULT_EXPORT_OPTIONS })
const formats = ref<ArchiveExportFormatDescriptor[]>(props.archiveAdapter.listExportFormats())
const busy = ref(false), ready = ref(false), error = ref(''), complete = ref(false), incomplete = ref(false)
const coverage = ref<ArchiveCoverageView>()
const refreshing = ref(false)
const preparedUrl = ref(''), preparedName = ref('')
const t = (key: TranslationKey) => translate(props.locale, key)
const isCurrent = computed(() => props.archiveAdapter.currentConversationId() === props.conversationId)
const updateRecommended = computed(
  () =>
    isCurrent.value &&
    (!coverage.value?.completeAtLastRead || coverage.value.storedLatestMatchesCurrent === false),
)
const statusKey = computed<TranslationKey>(() => {
  if (!coverage.value) return 'export.statusMissing'
  if (isCurrent.value && coverage.value.storedLatestMatchesCurrent === false)
    return 'export.statusNewer'
  if (!coverage.value.completeAtLastRead) return 'export.statusPartial'
  if (isCurrent.value && coverage.value.storedLatestMatchesCurrent)
    return 'export.statusCurrent'
  return 'export.statusSaved'
})
let queue: Promise<unknown> = Promise.resolve(), active = true
let exportController: AbortController | undefined
onMounted(async () => {
  try {
    const [settings, nextCoverage] = await Promise.all([
      props.settingsAdapter.get(),
      props.archiveAdapter.getCoverage(props.conversationId),
    ])
    if (active) {
      const normalized = normalizeExportOptions(settings.export)
      formats.value = props.archiveAdapter.listExportFormats()
      const selected = formats.value.find((format) => format.id === normalized.format)
      const fallback = formats.value.find((format) => format.isDefault) ?? formats.value[0]
      options.value = {
        ...normalized,
        format: selected?.id ?? fallback?.id ?? DEFAULT_EXPORT_OPTIONS.format,
      }
      coverage.value = nextCoverage
      ready.value = true
    }
  } catch {
    error.value = 'common.saveError'
  }
})
onBeforeUnmount(() => { active = false; exportController?.abort(); if (preparedUrl.value) URL.revokeObjectURL(preparedUrl.value) })
function clearPrepared() {
  if (preparedUrl.value) URL.revokeObjectURL(preparedUrl.value)
  preparedUrl.value = ''
  preparedName.value = ''
}
function remember() {
  const next = { ...options.value }
  clearPrepared()
  error.value = ''; complete.value = false; incomplete.value = false
  queue = queue.then(() => props.settingsAdapter.update({ export: next })).catch(() => { error.value = 'common.saveError' })
}
async function refreshBeforeExport() {
  if (!isCurrent.value || refreshing.value) return
  refreshing.value = true
  error.value = ''
  try {
    await props.archiveAdapter.collectCurrent()
    emit('close')
  } catch (cause) {
    const key = cause instanceof Error ? cause.message : ''
    error.value = key.startsWith('archive.error.') ? key : 'archive.error.unknown'
    refreshing.value = false
  }
}
async function download() {
  if (busy.value) return
  const controller = new AbortController()
  exportController = controller
  busy.value = true; error.value = ''; complete.value = false; incomplete.value = false
  try {
    await queue
    await props.settingsAdapter.update({ export: { ...options.value } })
    const outcome = await props.archiveAdapter.exportConversation(props.conversationId, { ...options.value }, controller.signal)
    clearPrepared()
    preparedUrl.value = URL.createObjectURL(outcome.blob)
    const base = (props.title || 'conversation').replace(/[\/:*?"<>|]/g, '-').slice(0, 100) || 'conversation'
    preparedName.value = `${base}.${outcome.extension}`
    complete.value = true
    incomplete.value = !outcome.complete
  } catch (cause) {
    if (!(cause instanceof DOMException && cause.name === 'AbortError')) error.value = 'export.failed'
  }
  finally {
    if (exportController === controller) exportController = undefined
    busy.value = false
  }
}
function cancelExport() {
  exportController?.abort()
}
</script>
<template>
  <section class="booster-export-dialog" :lang="locale">
    <header class="booster-section-header"><div><strong>{{ t('export.title') }}</strong><p>{{ title || t('identity.untitled') }}</p></div><button type="button" class="booster-icon-button" :aria-label="t('common.close')" @click="emit('close')"><X class="size-4" /></button></header>
    <div v-if="ready" class="booster-form-body">
      <div class="booster-export-status" :class="{ warning: updateRecommended }">
        <CheckCircle2 v-if="coverage?.completeAtLastRead && !updateRecommended" class="size-4" />
        <Info v-else class="size-4" />
        <div><strong>{{ t(statusKey) }}</strong><span v-if="coverage">{{ t('dock.messages') }}: {{ coverage.visibleMessageCount ?? 0 }} · {{ t('dock.details') }}: {{ coverage.internalRecordCount ?? 0 }}</span></div>
        <button v-if="updateRecommended" type="button" class="booster-action-secondary" :disabled="refreshing || busy" @click="refreshBeforeExport"><ArrowUpToLine class="size-4" />{{ t(refreshing ? 'export.refreshStarting' : 'export.refreshFirst') }}</button>
      </div>
      <label>{{ t('export.format') }}<select v-model="options.format" :disabled="busy" @change="remember"><option v-for="format in formats" :key="format.id" :value="format.id">{{ format.label }}</option></select></label>
      <label>{{ t('export.level') }}<select v-model="options.level" :disabled="busy" @change="remember"><option value="conversation">{{ t('export.conversation') }}</option><option value="custom">{{ t('export.custom') }}</option><option value="full">{{ t('export.full') }}</option></select></label>
      <fieldset v-if="options.level === 'custom'" :disabled="busy" class="booster-checkboxes">
        <label><input v-model="options.reasoning" type="checkbox" @change="remember" />{{ t('export.reasoning') }}</label>
        <label><input v-model="options.tools" type="checkbox" @change="remember" />{{ t('export.tools') }}</label>
        <label><input v-model="options.internal" type="checkbox" @change="remember" />{{ t('export.internal') }}</label>
        <label><input v-model="options.images" type="checkbox" @change="remember" />{{ t('export.images') }}</label><label><input v-model="options.files" type="checkbox" @change="remember" />{{ t('export.files') }}</label>
      </fieldset>
      <p class="booster-note">{{ t('export.metadata') }}</p>
      <p v-if="options.level === 'full' || options.images || options.files" class="booster-notice">{{ t('export.binaryUnavailable') }}</p>
      <p class="booster-note">{{ t('export.remember') }}</p>
      <p v-if="error" role="alert" class="booster-error">{{ t(error as TranslationKey) }}</p><p v-if="complete" role="status">{{ t(incomplete ? 'export.savedPartial' : 'export.saved') }}</p>
      <a v-if="preparedUrl" class="booster-action-primary booster-export-ready" :href="preparedUrl" :download="preparedName"><Download class="size-4" />{{ t('export.readyDownload') }}</a>
      <button v-else class="booster-action-primary" type="button" :disabled="busy" @click="download"><Download class="size-4" />{{ t(busy ? 'export.working' : 'export.prepare') }}</button>
      <button v-if="busy" class="booster-action-secondary" type="button" @click="cancelExport">{{ t('common.cancel') }}</button>
    </div><p v-else class="booster-note">{{ t(error ? 'common.saveError' : 'control.loading') }}</p>
  </section>
</template>
