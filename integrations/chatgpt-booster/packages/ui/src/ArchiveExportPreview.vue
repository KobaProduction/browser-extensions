<script setup lang="ts">
import {computed} from 'vue'
import type {ArchiveMessageLocation} from '@chatgpt-booster/core'
import type {ArchiveExportPreview} from './mount'
import {translate,type SupportedLocale,type TranslationKey} from './i18n'
const props=defineProps<{
  open:boolean
  loading:boolean
  failed:boolean
  preview:ArchiveExportPreview|undefined
  canNavigate:boolean
  busy:boolean
  collecting:boolean
  locale:SupportedLocale
}>()
const emit=defineEmits<{
  toggle:[]
  'inspect-message':[location:ArchiveMessageLocation]
  'open-archive':[]
}>()
const t=(key:TranslationKey)=>translate(props.locale,key)
const previewTail = computed(() => props.preview?.latest.filter((item) =>
  !props.preview?.earliest.some((first) => first.messageId === item.messageId),
) ?? [])
</script>
<template>
      <section class="booster-export-preview">
        <button type="button" class="booster-action-secondary" :disabled="busy" :aria-expanded="open" @click="emit('toggle')">
          {{ locale === 'ru' ? (open ? 'Скрыть предпросмотр' : 'Предпросмотр начала и конца') : (open ? 'Hide preview' : 'Preview first and last messages') }}
        </button>
        <div v-if="open" class="booster-export-preview-content">
          <div v-if="loading" class="booster-export-preview-skeleton" role="status">
            <p class="booster-note">{{ t('reader.loading') }}</p>
            <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
          </div>
          <p v-else-if="failed" role="alert" class="booster-error">{{ t('reader.error') }}</p>
          <template v-else-if="preview">
            <p class="booster-note">{{ locale === 'ru' ? 'Известные границы (не доказанные корень/конец версии)' : 'Known endpoints (not verified version root/tip)' }} · {{ preview.knownCount }}</p>
            <p class="booster-note">
              {{ locale === 'ru' ? 'Непрерывность страниц' : 'Page continuity' }}: {{ preview.sourcePageContinuity }} ·
              {{ locale === 'ru' ? 'Полнота захвата' : 'Capture coverage' }}: {{ preview.captureCoverage }}
            </p>
            <p v-if="preview.hasUnsequencedMessages" class="booster-note">
              {{ locale === 'ru' ? 'Есть сообщения без подтверждённого времени; они не вошли в хронологический предпросмотр.' : 'Some messages lack verified timestamps and are not in the chronological preview.' }}
            </p>
            <p v-if="preview.latestHeadMatches === false" class="booster-note">
              {{ locale === 'ru' ? 'Текущая версия не совпадает с сохранённой вершиной.' : 'Current version does not match the saved tip.' }}
            </p>
            <p v-if="!preview.selectedTipId" class="booster-note">
              {{ locale === 'ru' ? 'Выбранная версия пока не подтверждена.' : 'Selected version is not confirmed.' }}
            </p>
            <p class="booster-note">{{ locale === 'ru' ? 'Первые известные' : 'Earliest known' }}</p>
            <div v-for="message in preview.earliest" :key="'early-'+message.messageId" class="booster-note booster-export-preview-record">
              <span><strong>{{ message.role ?? 'unknown' }}</strong> — {{ message.text || (locale === 'ru' ? 'Нет текстового содержимого' : 'No text') }}</span>
              <button v-if="message.location && canNavigate" type="button" class="booster-action-secondary" :disabled="busy || collecting || loading" @click="emit('inspect-message', message.location)">{{ t('export.inspectMessage') }}</button>
            </div>
            <p v-if="preview.hiddenKnownCount" class="booster-note">… {{ preview.hiddenKnownCount }} {{ locale === 'ru' ? 'промежуточных записей скрыто' : 'middle records hidden' }} …</p>
            <p v-if="previewTail.length" class="booster-note">{{ locale === 'ru' ? 'Последние известные' : 'Latest known' }}</p>
            <div v-for="message in previewTail" :key="'last-'+message.messageId" class="booster-note booster-export-preview-record">
              <span><strong>{{ message.role ?? 'unknown' }}</strong> — {{ message.text || (locale === 'ru' ? 'Нет текстового содержимого' : 'No text') }}</span>
              <button v-if="message.location && canNavigate" type="button" class="booster-action-secondary" :disabled="busy || collecting || loading" @click="emit('inspect-message', message.location)">{{ t('export.inspectMessage') }}</button>
            </div>
            <button type="button" class="booster-action-secondary" @click="emit('open-archive')">
              {{ locale === 'ru' ? 'Полный архив' : 'Full archive' }}
            </button>
          </template>
        </div>
      </section>
</template>
