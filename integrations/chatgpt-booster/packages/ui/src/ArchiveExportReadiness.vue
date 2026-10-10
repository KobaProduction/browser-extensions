<script setup lang="ts">
import {computed} from 'vue'
import type {ArchiveExportReadiness,ArchiveExportBlocker,ArchiveCollectionBlocker} from '@chatgpt-booster/core'
import {translate,type SupportedLocale,type TranslationKey} from './i18n'

const props=defineProps<{
  readiness:ArchiveExportReadiness|undefined
  loading:boolean
  failed:boolean
  activeBlockers:readonly ArchiveExportBlocker[]
  busy:boolean
  collecting:boolean
  captureSettingsAvailable:boolean
  captureExcluded:string
  locale:SupportedLocale
}>()
const emit=defineEmits<{
  recheck:[]
  'capture-settings':[]
  'omit-assets':[]
  'use-json':[]
  'open-archive':[]
}>()
const t=(key:TranslationKey)=>translate(props.locale,key)
const blockerKeys: Record<ArchiveExportBlocker, TranslationKey> = {
  account_unverified: 'export.blocker.account', source_incompatible: 'export.blocker.signature',
  storage_unavailable: 'export.blocker.storage', conversation_missing: 'export.blocker.noCopy',
  selection_missing: 'export.blocker.noSelection', page_unknown: 'export.blocker.noPages',
  page_incomplete: 'export.blocker.pages', capture_unknown: 'export.blocker.captureUnknown',
  capture_omissions: 'export.blocker.omissions', head_mismatch: 'export.blocker.head',
  source_changed: 'export.blocker.changed', tip_missing: 'export.blocker.tip',
  missing_parent: 'export.blocker.parent', parent_unknown: 'export.blocker.parentUnknown',
  cyclic_parent: 'export.blocker.cycle', depth_limit: 'export.blocker.limit',
  assets_unverified: 'export.blocker.assets', technical_requires_json: 'export.blocker.json',
}
const collectionKeys: Record<ArchiveCollectionBlocker, TranslationKey> = {
  not_current: 'export.collectionOpenChat', disabled: 'archive.error.disabled',
  unavailable: 'export.collectionUnavailable', account_unverified: 'archive.error.auth',
  source_incompatible: 'archive.error.incompatibleSource', draft: 'archive.error.draft',
  attachments: 'archive.error.attachments', generating: 'archive.error.generating',
}
const pageLabel = computed<TranslationKey>(() => props.readiness?.pageContinuity === 'verified'
  ? 'export.gateVerified' : props.readiness?.pageContinuity === 'partial'
    ? 'export.gatePartial' : 'export.gateUnknown')
const captureLabel = computed<TranslationKey>(() => props.readiness?.captureCoverage === 'complete'
  ? 'export.gateVerified' : props.readiness?.captureCoverage === 'omitted'
    ? 'export.gateOmitted' : 'export.gateUnknown')
const pathLabel = computed<TranslationKey>(() => props.readiness?.pathVerification === 'verified_checkpoint'
  ? 'export.gateCheckpoint' : props.readiness?.pathVerification === 'needs_verification'
    ? 'export.gateAtPrepare' : 'export.gateUnknown')
const headLabel = computed<TranslationKey>(() => props.readiness?.latestHeadMatches === true
  ? 'export.gateMatches' : props.readiness?.latestHeadMatches === false
    ? 'export.gateMismatch' : 'export.gateUnknown')
</script>
<template>
      <section class="booster-export-readiness" :aria-busy="loading">
        <header><strong>{{ t('export.inspectTitle') }}</strong><button type="button" class="booster-action-secondary" :disabled="busy || collecting || loading" @click="emit('recheck')">{{ t('export.inspectRefresh') }}</button></header>
        <p v-if="loading" role="status" class="booster-note">{{ t('export.inspectLoading') }}</p>
        <p v-else-if="failed" role="alert" class="booster-error">{{ t('export.inspectFailed') }}</p>
        <template v-else-if="readiness">
          <dl>
            <div><dt>{{ t('export.sourceAdapter') }}</dt><dd>{{ readiness.sourceAdapterVersion }}</dd></div>
            <div><dt>{{ t('export.gatePages') }}</dt><dd>{{ t(pageLabel) }} · {{ readiness.linkedPageCount }}</dd></div>
            <div><dt>{{ t('export.gateCapture') }}</dt><dd>{{ t(captureLabel) }}</dd></div>
            <div><dt>{{ t('export.gatePath') }}</dt><dd>{{ t(pathLabel) }}</dd></div>
            <div><dt>{{ t('export.gateHead') }}</dt><dd>{{ t(headLabel) }}</dd></div>
          </dl>
          <ul v-if="activeBlockers.length" class="booster-export-blockers" role="status">
            <li v-for="reason in activeBlockers" :key="reason">{{ t(blockerKeys[reason]) }}</li>
          </ul>
          <p v-else class="booster-note">{{ t('export.inspectFinalGate') }}</p>
          <p v-if="readiness.collectionBlocker" class="booster-note">{{ t(collectionKeys[readiness.collectionBlocker]) }}</p>
          <p v-if="activeBlockers.includes('capture_omissions') || activeBlockers.includes('capture_unknown')" class="booster-note">{{ t('export.captureRepairHint') }}</p>
          <p v-if="captureExcluded" class="booster-note">{{ t('export.captureExcluded') }}: {{ captureExcluded }}</p>
          <div class="booster-export-recovery-actions">
            <button v-if="captureSettingsAvailable" type="button" class="booster-action-secondary" :disabled="busy || collecting" @click="emit('capture-settings')">{{ t('export.inspectCaptureSettings') }}</button>
            <button v-if="activeBlockers.includes('assets_unverified')" type="button" class="booster-action-secondary" :disabled="busy" @click="emit('omit-assets')">{{ t('export.inspectNoFiles') }}</button>
            <button v-if="activeBlockers.includes('technical_requires_json')" type="button" class="booster-action-secondary" :disabled="busy" @click="emit('use-json')">{{ t('export.inspectUseJson') }}</button>
            <button v-if="activeBlockers.length && readiness.knownRecordCount" type="button" class="booster-action-secondary" :disabled="busy" @click="emit('open-archive')">{{ t('export.inspectArchive') }}</button>
          </div>
        </template>
      </section>
</template>
