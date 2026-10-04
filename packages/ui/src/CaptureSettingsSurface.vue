<script setup lang="ts">
import type { ArchiveCaptureContext, SettingsAdapter } from '@chatgpt-booster/core'
import { ShieldCheck, X } from 'lucide-vue-next'
import CaptureSettings from './CaptureSettings.vue'
import { translate, type SupportedLocale } from './i18n'
import type { ArchiveDataAdapter } from './mount'

const props = defineProps<{
  settingsAdapter: SettingsAdapter
  archiveAdapter?: ArchiveDataAdapter | undefined
  context?: ArchiveCaptureContext | undefined
  locale: SupportedLocale
}>()
const emit = defineEmits<{ close: [] }>()
const t = (key: Parameters<typeof translate>[1]) => translate(props.locale, key)
</script>

<template>
  <section class="booster-capture-surface" :lang="locale">
    <header class="booster-section-header">
      <div class="booster-reader-heading"><ShieldCheck class="size-5" /><div><strong>{{ t('capture.title') }}</strong><p>{{ t('capture.subtitle') }}</p></div></div>
      <button class="booster-icon-button" type="button" :aria-label="t('common.close')" @click="emit('close')"><X class="size-4" /></button>
    </header>
    <CaptureSettings :settings-adapter="settingsAdapter" :archive-adapter="archiveAdapter" :context="context" :locale="locale" />
  </section>
</template>
