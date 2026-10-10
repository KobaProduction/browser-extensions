<script setup lang="ts">
import type {ArchiveExportOptions,ArchiveExportFormatDescriptor} from '@chatgpt-booster/core'
import {translate,type SupportedLocale,type TranslationKey} from './i18n'

/** ChatGPT-specific export option vocabulary; generic export widgets contain no native API schema. */
const props=defineProps<{
  options:ArchiveExportOptions
  formats:readonly ArchiveExportFormatDescriptor[]
  archiveGeneration:number|undefined
  busy:boolean
  preferenceLoading:boolean
  locale:SupportedLocale
}>()
const emit=defineEmits<{change:[options:ArchiveExportOptions]}>()
const t=(key:TranslationKey)=>translate(props.locale,key)
function updateSelect<K extends keyof ArchiveExportOptions>(key:K,event:Event){
  const input=event.target
  if(!(input instanceof HTMLSelectElement))return
  emit('change',{...props.options,[key]:input.value as ArchiveExportOptions[K]})
}
function updateCheckbox<K extends keyof ArchiveExportOptions>(key:K,event:Event){
  const input=event.target
  if(!(input instanceof HTMLInputElement))return
  emit('change',{...props.options,[key]:input.checked as ArchiveExportOptions[K]})
}
</script>
<template>
      <label>{{ t('export.format') }}<select :value="options.format" :disabled="busy || preferenceLoading" @change="updateSelect('format',$event)"><option v-for="format in formats" :key="format.id" :value="format.id">{{ format.label }}</option></select></label>
      <label v-if="archiveGeneration === 4">
        {{ locale === 'ru' ? 'Упаковка результата' : 'Output packaging' }}
        <select :value="options.packaging" :disabled="busy || preferenceLoading" @change="updateSelect('packaging',$event)">
          <option value="none">{{ locale === 'ru' ? 'Без упаковки' : 'None' }}</option>
          <option value="zip">{{ locale === 'ru' ? 'ZIP (без сжатия)' : 'ZIP (stored, no compression)' }}</option>
        </select>
      </label>
      <p v-if="archiveGeneration === 4 && options.packaging === 'zip'" class="booster-note">
        {{ locale === 'ru' ? 'ZIP включает файл экспорта и archive-manifest.json, но не бинарные вложения. Сжатие не применяется.' : 'ZIP contains the export and archive-manifest.json, not binary attachments. No compression is applied.' }}
      </p>
      <label>{{ t('export.level') }}<select :value="options.level" :disabled="busy || preferenceLoading" @change="updateSelect('level',$event)"><option value="conversation">{{ t('export.conversation') }}</option><option value="custom">{{ t('export.custom') }}</option><option value="full">{{ t('export.full') }}</option></select></label>
      <p class="booster-note">{{ t(options.level === 'full' ? 'export.profileFull' : options.level === 'custom' ? 'export.profileCustom' : 'export.profileConversation') }}</p>
      <p v-if="archiveGeneration === 4 && options.level !== 'full' && (options.format === 'json' || options.format === 'json-compact')" class="booster-note">{{ t('export.timebaseHint') }}</p>
      <fieldset v-if="options.level === 'custom'" :disabled="busy" class="booster-checkboxes">
        <label><input :checked="options.reasoning" type="checkbox" @change="updateCheckbox('reasoning',$event)" />{{ t('export.reasoning') }}</label>
        <div v-if="archiveGeneration === 4 && options.reasoning" class="booster-export-suboptions">
          <label><input :checked="options.reasoningRecap" type="checkbox" @change="updateCheckbox('reasoningRecap',$event)" />{{ t('export.reasoningRecap') }}</label>
          <label><input :checked="options.reasoningFull" type="checkbox" @change="updateCheckbox('reasoningFull',$event)" />{{ t('export.reasoningFull') }}</label>
        </div>
        <label><input :checked="options.tools" type="checkbox" @change="updateCheckbox('tools',$event)" />{{ t('export.tools') }}</label>
        <div v-if="archiveGeneration === 4 && options.tools" class="booster-export-suboptions">
          <label><input :checked="options.toolCalls" type="checkbox" @change="updateCheckbox('toolCalls',$event)" />{{ t('export.toolCalls') }}</label>
          <label><input :checked="options.toolResults" type="checkbox" @change="updateCheckbox('toolResults',$event)" />{{ t('export.toolResults') }}</label>
          <label><input :checked="options.toolSourceContent" type="checkbox" @change="updateCheckbox('toolSourceContent',$event)" />{{ t('export.toolSourceContent') }}</label>
        </div>
        <label><input :checked="options.internal" type="checkbox" @change="updateCheckbox('internal',$event)" />{{ t('export.internal') }}</label>
        <template v-if="archiveGeneration === 4">
          <label><input :checked="options.modelEvidence" type="checkbox" @change="updateCheckbox('modelEvidence',$event)" />{{ t('export.modelEvidence') }}</label>
          <p v-if="options.modelEvidence" class="booster-note">{{ t('export.modelEvidenceScope') }}</p>
          <label><input :checked="options.dictationEditEvidence" type="checkbox" @change="updateCheckbox('dictationEditEvidence',$event)" />{{ t('export.dictationEditEvidence') }}</label>
          <label><input :checked="options.sourceRevisions" type="checkbox" @change="updateCheckbox('sourceRevisions',$event)" />{{ t('export.sourceRevisions') }}</label>
          <label><input :checked="options.attachmentMetadata" type="checkbox" @change="updateCheckbox('attachmentMetadata',$event)" />{{ t('export.attachmentMetadata') }}</label>
          <p class="booster-note">{{ t('export.evidenceWarning') }}</p>
        </template>
        <label><input :checked="options.images" type="checkbox" @change="updateCheckbox('images',$event)" />{{ t('export.images') }}</label><label><input :checked="options.files" type="checkbox" @change="updateCheckbox('files',$event)" />{{ t('export.files') }}</label>
      </fieldset>
      <fieldset v-if="options.level === 'full'" :disabled="busy" class="booster-checkboxes">
        <label><input :checked="options.images" type="checkbox" @change="updateCheckbox('images',$event)" />{{ t('export.images') }}</label>
        <label><input :checked="options.files" type="checkbox" @change="updateCheckbox('files',$event)" />{{ t('export.files') }}</label>
      </fieldset>
</template>
