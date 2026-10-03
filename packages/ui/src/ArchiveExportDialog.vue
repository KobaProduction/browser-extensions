<script setup lang="ts">
import { DEFAULT_EXPORT_OPTIONS, normalizeExportOptions, type ArchiveExportOptions, type SettingsAdapter } from '@chatgpt-booster/core'
import { Download, X } from 'lucide-vue-next'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { translate, type SupportedLocale, type TranslationKey } from './i18n'
import type { ArchiveDataAdapter } from './mount'
const props = defineProps<{ archiveAdapter: ArchiveDataAdapter; settingsAdapter: SettingsAdapter; conversationId: string; title?: string | null; locale: SupportedLocale }>()
const emit = defineEmits<{ close: [] }>()
const options = ref<ArchiveExportOptions>({ ...DEFAULT_EXPORT_OPTIONS })
const busy = ref(false), ready = ref(false), error = ref(''), complete = ref(false)
const t = (key: TranslationKey) => translate(props.locale, key)
let queue: Promise<unknown> = Promise.resolve(), active = true
onMounted(async () => { try { const s = await props.settingsAdapter.get(); if (active) { options.value = normalizeExportOptions(s.export); ready.value = true } } catch { error.value = 'common.saveError' } })
onBeforeUnmount(() => { active = false })
function remember() {
  const next = { ...options.value }
  error.value = ''; complete.value = false
  queue = queue.then(() => props.settingsAdapter.update({ export: next })).catch(() => { error.value = 'common.saveError' })
}
async function download() {
  if (busy.value) return
  busy.value = true; error.value = ''; complete.value = false
  try {
    await queue
    await props.settingsAdapter.update({ export: { ...options.value } })
    await props.archiveAdapter.exportConversation(props.conversationId, { ...options.value })
    complete.value = true
  } catch (cause) { error.value = cause instanceof Error && cause.message === 'export.binaryUnavailable' ? cause.message : 'export.failed' }
  finally { busy.value = false }
}
</script>
<template>
  <section class="booster-export-dialog" :lang="locale">
    <header class="booster-section-header"><div><strong>{{ t('export.title') }}</strong><p>{{ title || t('identity.untitled') }}</p></div><button type="button" class="booster-icon-button" :aria-label="t('common.close')" @click="emit('close')"><X class="size-4" /></button></header>
    <div v-if="ready" class="booster-form-body">
      <label>{{ t('export.format') }}<select v-model="options.format" :disabled="busy" @change="remember"><option value="json">JSON</option><option value="markdown">Markdown</option></select></label>
      <label>{{ t('export.level') }}<select v-model="options.level" :disabled="busy" @change="remember"><option value="conversation">{{ t('export.conversation') }}</option><option value="custom">{{ t('export.custom') }}</option><option value="full">{{ t('export.full') }}</option></select></label>
      <fieldset v-if="options.level === 'custom'" :disabled="busy" class="booster-checkboxes">
        <label><input v-model="options.reasoning" type="checkbox" @change="remember" />{{ t('export.reasoning') }}</label>
        <label><input v-model="options.tools" type="checkbox" @change="remember" />{{ t('export.tools') }}</label>
        <label><input v-model="options.internal" type="checkbox" @change="remember" />{{ t('export.internal') }}</label>
        <label><input v-model="options.images" type="checkbox" :disabled="!options.images" @change="remember" />{{ t('export.images') }}</label><label><input v-model="options.files" type="checkbox" :disabled="!options.files" @change="remember" />{{ t('export.files') }}</label>
      </fieldset>
      <p class="booster-note">{{ t('export.metadata') }}</p>
      <p v-if="options.level === 'full' || options.images || options.files" class="booster-notice">{{ t('export.binaryUnavailable') }}</p>
      <p class="booster-note">{{ t('export.remember') }}</p>
      <p v-if="error" role="alert" class="booster-error">{{ t(error as TranslationKey) }}</p><p v-if="complete" role="status">{{ t('export.saved') }}</p>
      <button class="booster-action-primary" type="button" :disabled="busy || options.level === 'full' || options.images || options.files" @click="download"><Download class="size-4" />{{ t(busy ? 'export.working' : 'export.download') }}</button>
    </div><p v-else class="booster-note">{{ t(error ? 'common.saveError' : 'control.loading') }}</p>
  </section>
</template>
