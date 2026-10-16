<script setup lang="ts">
import type { ArchiveCaptureContext, SettingsAdapter } from '@chatgpt-booster/core'
import { Button } from '@kobaproduction/browser-ui'
import ShieldCheck from 'lucide-vue-next/dist/esm/icons/shield-check.js'
import X from 'lucide-vue-next/dist/esm/icons/x.js'
import CaptureSettings from './CaptureSettings.vue'
import { type SupportedLocale, translate } from './i18n'
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
      <Button variant="ghost" size="icon" type="button" :aria-label="t('common.close')" @click="emit('close')"><X class="size-4" /></Button>
    </header>
    <CaptureSettings :settings-adapter="settingsAdapter" :archive-adapter="archiveAdapter" :context="context" :locale="locale" />
  </section>
</template>
