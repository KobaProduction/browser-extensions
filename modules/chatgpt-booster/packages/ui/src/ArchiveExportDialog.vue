<script setup lang="ts">
import {
  ARCHIVE_SOURCE_INCOMPATIBLE_EVENT,
  ArchiveExportBlockedError,
  type ArchiveExportReadiness,
  type ArchiveExportBlocker,
  type ArchiveCollectionBlocker,
  type ArchiveCaptureContext,
  type ArchiveMessageLocation,
  DEFAULT_EXPORT_OPTIONS,
  HISTORY_LOADER_STATE_EVENT,
  HISTORY_LOADER_STOP_EVENT,
  type HistoryLoaderState,
  type HistoryLoaderStopRequest,
  type HistoryCollectionStopReason,
  normalizeExportOptions,
  type ArchiveExportFormatDescriptor,
  type ArchiveExportOptions,
  type ArchiveExportProgress,
  type SettingsAdapter,
} from '@chatgpt-booster/core'
import ArrowUpToLine from 'lucide-vue-next/dist/esm/icons/arrow-up-to-line.js'
import CheckCircle2 from 'lucide-vue-next/dist/esm/icons/circle-check.js'
import Download from 'lucide-vue-next/dist/esm/icons/download.js'
import Info from 'lucide-vue-next/dist/esm/icons/info.js'
import X from 'lucide-vue-next/dist/esm/icons/x.js'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ArchiveProgress } from '@kobaproduction/browser-ui'
import { translate, type SupportedLocale, type TranslationKey } from './i18n'
import type { ArchiveCoverageView, ArchiveDataAdapter, ArchiveExportPreview } from './mount'
const props = defineProps<{ archiveAdapter: ArchiveDataAdapter; settingsAdapter: SettingsAdapter; conversationId: string; title?: string | null; locale: SupportedLocale; suspended?: boolean }>()
const emit = defineEmits<{ close: []; 'open-archive': [conversationId: string, location?: ArchiveMessageLocation]; 'open-capture': [context: ArchiveCaptureContext] }>()
const options = ref<ArchiveExportOptions>({ ...DEFAULT_EXPORT_OPTIONS })
type ExportPreferenceScope = 'global' | 'project' | 'conversation'
const preferenceScope = ref<ExportPreferenceScope>('global')
const preferenceSource = ref<ExportPreferenceScope>('global')
const preferenceHasProject = ref(false)
const preferenceContext = ref<{ accountId: string; projectId: string | null }>()
const preferenceSaving = ref(false)
const preferenceLoading = ref(false)
let preferenceRevision = 0

const formats = ref<ArchiveExportFormatDescriptor[]>(props.archiveAdapter.listExportFormats())
const busy = ref(false), ready = ref(false), error = ref(''), complete = ref(false), incomplete = ref(false)
const coverage = ref<ArchiveCoverageView>()
const readiness = ref<ArchiveExportReadiness>()
const readinessLoading = ref(false)
const readinessDirty = ref(true)
const readinessFailed = ref(false)
const failedBlocker = ref<ArchiveExportBlocker | null>(null)
let readinessController: AbortController | undefined
let readinessRevision = 0
let readinessTimer: ReturnType<typeof setTimeout> | undefined
let unsubscribeExport: (() => void) | undefined
let unsubscribeCapturePolicy: (() => void) | undefined
const refreshing = ref(false)
const collecting = ref(false)
const collectionPaused = ref(false)
const collectionSessionId = ref<number>()
const collectionSaving = ref(false)
const collectionStopReason = ref<HistoryCollectionStopReason>()
const incompatible = ref(false)
const preparedUrl = ref(''), preparedName = ref('')
const exportProgress = ref<Readonly<ArchiveExportProgress> | null>(null)
const exportCancelled = ref(false)
const preparedBytes = ref<number | null>(null)
const filename = ref(props.title || 'conversation')
// Canonical recovered records must remain exportable when the separate
// source-v4 selected-path verification blocks the complete-export pipeline.
const recoveredAvailable = ref(false)
const recoveredBusy = ref(false)
const recoveredError = ref('')
let recoveredRevision = 0
async function checkRecovered() {
  const ticket = ++recoveredRevision
  const owner = props.archiveAdapter.currentAccountId?.() ?? null
  recoveredAvailable.value = false
  if (!owner || !props.archiveAdapter.isRecoveredConversation ||
      !props.archiveAdapter.exportRecoveredConversation) return
  try {
    const found = await props.archiveAdapter.isRecoveredConversation(props.conversationId)
    if (active && ticket === recoveredRevision &&
        props.archiveAdapter.currentAccountId?.() === owner)
      recoveredAvailable.value = found
  } catch {
    // The unverified account/failed read is not an exportable namespace.
  }
}
async function downloadRecovered(format: 'json' | 'markdown' | 'json-gzip') {
  if (!recoveredAvailable.value || recoveredBusy.value || props.suspended ||
      !props.archiveAdapter.exportRecoveredConversation) return
  const owner = props.archiveAdapter.currentAccountId?.()
  if (!owner) return
  recoveredBusy.value = true
  recoveredError.value = ''
  try {
    const blob = await props.archiveAdapter.exportRecoveredConversation(props.conversationId, format)
    if (!active || props.suspended || props.archiveAdapter.currentAccountId?.() !== owner) return
    if (!blob || blob.size === 0) throw new Error('Recovered conversation has no exportable records')
    const url = URL.createObjectURL(blob)
    try {
      const a = document.createElement('a')
      const base = filename.value.replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 100) || 'conversation'
      a.href = url
      a.download = `${base}-saved-partial.${format === 'json-gzip' ? 'json.gz' : format === 'json' ? 'json' : 'md'}`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    }
  } catch (cause) {
    if (active) recoveredError.value = cause instanceof Error ? cause.message : 'Recovered export failed'
  } finally {
    if (active) recoveredBusy.value = false
  }
}
const previewOpen = ref(false)
const previewLoading = ref(false)
const preview = ref<ArchiveExportPreview>()
const previewError = ref(false)
let previewRevision = 0
const previewTail = computed(() => preview.value?.latest.filter((item) =>
  !preview.value?.earliest.some((first) => first.messageId === item.messageId),
) ?? [])
const t = (key: TranslationKey) => translate(props.locale, key)
const collectionStopKeys: Record<HistoryCollectionStopReason, TranslationKey> = {
  user: 'export.collectionStoppedUser',
  export_closed: 'export.collectionStoppedClosed',
  export_suspended: 'export.collectionStoppedSuspended',
  tab_hidden: 'export.collectionStoppedHidden',
  user_takeover: 'export.collectionStoppedTakeover',
  navigation: 'export.collectionStoppedNavigation',
  account_changed: 'export.collectionStoppedAccount',
  selection_changed: 'export.collectionStoppedSelection',
  policy_changed: 'export.collectionStoppedPolicy',
  source_incompatible: 'export.collectionStoppedSource',
  superseded: 'export.collectionStoppedSuperseded',
  expired: 'export.collectionStoppedExpired',
  runtime_stopped: 'export.collectionStoppedRuntime',
}
const collectionPauseLabel = computed(() => {
  const reason = collectionStopReason.value
  return reason ? t(collectionStopKeys[reason] ?? 'export.collectionStoppedUser')
    : t('export.collectionStoppedUser')
})

const exportPhaseKeys: Record<ArchiveExportProgress['phase'], TranslationKey> = {
  checking: 'export.phaseChecking',
  tracing: 'export.phaseTracing',
  serializing: 'export.phaseSerializing',
  packaging: 'export.phasePackaging',
  verifying: 'export.phaseVerifying',
  ready: 'export.phaseReady',
}
const exportPhaseLabel = computed(() => exportProgress.value
  ? t(exportPhaseKeys[exportProgress.value.phase]) : t('export.working'))
function formatExportBytes(value: number): string {
  const scale = value >= 1024 * 1024 ? 1024 * 1024 : value >= 1024 ? 1024 : 1
  const label = scale === 1 ? t('export.progressBytes') : scale === 1024 ? 'KiB' : 'MiB'
  const number = new Intl.NumberFormat(props.locale, { maximumFractionDigits: scale === 1 ? 0 : 1 })
  return `${number.format(value / scale)} ${label}`
}
const exportCounter = computed(() => {
  const progress = exportProgress.value
  if (!progress || progress.completed === null) return ''
  if (progress.unit === 'bytes')
    return `${formatExportBytes(progress.completed)} / ${formatExportBytes(progress.total)}`
  const number = new Intl.NumberFormat(props.locale)
  const count = progress.total === null ? number.format(progress.completed)
    : `${number.format(progress.completed)} / ${number.format(progress.total)}`
  return `${count} ${t('export.progressRecords')}`
})
const contextRevision = ref(0)
const isCurrent = computed(() => {
  void contextRevision.value
  return props.archiveAdapter.currentConversationId() === props.conversationId
})
const wantsAssets = computed(
  () => options.value.level !== 'conversation' && (options.value.images || options.value.files),
)
const effectiveOptions = computed<ArchiveExportOptions>(() =>
  options.value.level === 'conversation'
    ? { ...options.value, images: false, files: false }
    : { ...options.value },
)

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
const activeBlockers = computed(() => [...new Set([
  ...(readiness.value?.blockers ?? []), ...(failedBlocker.value ? [failedBlocker.value] : []),
])])
const prepareBlocked = computed(() => !!props.archiveAdapter.getExportReadiness &&
  (readinessLoading.value || readinessDirty.value || readinessFailed.value ||
   !readiness.value || activeBlockers.value.length > 0 ||
   (!!props.archiveAdapter.saveExportPreferences && !preferenceContext.value)))
const collectionDisabled = computed(() => !!props.archiveAdapter.getExportReadiness &&
  (readinessLoading.value || readinessDirty.value || !readiness.value ||
   readiness.value.collectionBlocker !== null))
const captureSettingsAvailable = computed(() => !!readiness.value?.captureCategories &&
  !readinessDirty.value && !readinessLoading.value &&
  !activeBlockers.value.includes('account_unverified'))
const savedPathVerified = computed(() => props.archiveAdapter.getExportReadiness
  ? !readinessDirty.value && !readinessLoading.value && !activeBlockers.value.length &&
    readiness.value?.pathVerification === 'verified_checkpoint'
  : coverage.value?.completeAtLastRead === true)
const captureExcluded = computed(() => {
  const categories = readiness.value?.captureCategories
  if (!categories) return ''
  const labels: string[] = []
  if (!categories.reasoning) labels.push(t('capture.reasoning'))
  if (!categories.tools) labels.push(t('capture.tools'))
  if (!categories.internal) labels.push(t('capture.internal'))
  return labels.join(', ')
})
const pageLabel = computed<TranslationKey>(() => readiness.value?.pageContinuity === 'verified'
  ? 'export.gateVerified' : readiness.value?.pageContinuity === 'partial'
    ? 'export.gatePartial' : 'export.gateUnknown')
const captureLabel = computed<TranslationKey>(() => readiness.value?.captureCoverage === 'complete'
  ? 'export.gateVerified' : readiness.value?.captureCoverage === 'omitted'
    ? 'export.gateOmitted' : 'export.gateUnknown')
const pathLabel = computed<TranslationKey>(() => readiness.value?.pathVerification === 'verified_checkpoint'
  ? 'export.gateCheckpoint' : readiness.value?.pathVerification === 'needs_verification'
    ? 'export.gateAtPrepare' : 'export.gateUnknown')
const headLabel = computed<TranslationKey>(() => readiness.value?.latestHeadMatches === true
  ? 'export.gateMatches' : readiness.value?.latestHeadMatches === false
    ? 'export.gateMismatch' : 'export.gateUnknown')
const updateRecommended = computed(() => {
  if (!isCurrent.value) return false
  if (props.archiveAdapter.getExportReadiness) return !readinessLoading.value &&
    activeBlockers.value.some((reason) => [
      'conversation_missing', 'selection_missing', 'page_unknown', 'page_incomplete',
      'capture_omissions', 'capture_unknown', 'head_mismatch', 'tip_missing', 'missing_parent',
    ].includes(reason))
  return !coverage.value?.completeAtLastRead || coverage.value.storedLatestMatchesCurrent === false
})
const statusKey = computed<TranslationKey>(() => {
  if (props.archiveAdapter.getExportReadiness) {
    if (readinessLoading.value || readinessDirty.value) return 'export.inspectLoading'
    if (readinessFailed.value || !readiness.value) return 'export.inspectFailed'
    if (activeBlockers.value.length) return 'export.inspectBlocked'
    return readiness.value.pathVerification === 'verified_checkpoint'
      ? 'export.statusSaved' : 'export.inspectPendingPath'
  }
  if (!coverage.value) return 'export.statusMissing'
  if (isCurrent.value && coverage.value.storedLatestMatchesCurrent === false)
    return 'export.statusNewer'
  if (!coverage.value.completeAtLastRead) return 'export.statusPartial'
  if (isCurrent.value && coverage.value.storedLatestMatchesCurrent) return 'export.statusCurrent'
  return 'export.statusSaved'
})
let queue: Promise<unknown> = Promise.resolve(), active = true
let exportController: AbortController | undefined
let unsubscribeContext: (() => void) | undefined
async function refreshReadiness(resetFailure = false) {
  if (!props.archiveAdapter.getExportReadiness || !ready.value || props.suspended || !active) return
  if (resetFailure) failedBlocker.value = null
  clearTimeout(readinessTimer)
  readinessController?.abort()
  const controller = new AbortController()
  const revision = ++readinessRevision
  readinessController = controller
  readinessLoading.value = true
  readinessFailed.value = false
  try {
    const result = await props.archiveAdapter.getExportReadiness(
      props.conversationId, { ...effectiveOptions.value }, controller.signal,
    )
    if (!active || controller.signal.aborted || revision !== readinessRevision) return
    if (readiness.value?.sourceRevision !== result.sourceRevision ||
        (readiness.value?.sourceInstanceId ?? null) !== (result.sourceInstanceId ?? null) ||
        readiness.value?.selectedTipId !== result.selectedTipId) {
      failedBlocker.value = null
      if (readiness.value) clearPrepared()
    }
    readiness.value = result
    readinessDirty.value = false
    if (previewOpen.value && !preview.value && !previewLoading.value && !collecting.value && !busy.value)
      void loadPreview()
  } catch (cause) {
    if (!active || controller.signal.aborted || revision !== readinessRevision) return
    readinessFailed.value = true
    readiness.value = undefined
  } finally {
    if (readinessController === controller) {
      readinessController = undefined
      readinessLoading.value = false
    }
  }
}
function scheduleReadiness() {
  readinessDirty.value = true
  readinessController?.abort()
  clearTimeout(readinessTimer)
  if (!active || !ready.value || props.suspended || busy.value) return
  // Coalesce committed pages/settings events; this is not a simulated progress delay.
  readinessTimer = setTimeout(() => { void refreshReadiness() }, 180)
}
function invalidateExportSource() {
  cancelExport()
  clearPrepared()
  failedBlocker.value = null
  ++previewRevision
  preview.value = undefined
  previewLoading.value = false
  scheduleReadiness()
}
async function recheckExport() {
  if (props.archiveAdapter.getExportPreferences && !preferenceContext.value)
    await changePreferenceScope()
  await refreshReadiness(true)
}
function openCaptureSettings() {
  if (!captureSettingsAvailable.value || !readiness.value) return
  stopCollection('export_suspended')
  cancelExport()
  emit('open-capture', {
    scope: 'conversation', id: props.conversationId, title: props.title ?? null,
    projectId: readiness.value.projectId,
  })
}
function omitUnavailableFiles() {
  options.value = { ...options.value, images: false, files: false }
  remember()
}
function selectTechnicalJson() {
  options.value = { ...options.value, format: 'json' }
  remember()
}
watch(effectiveOptions, () => {
  failedBlocker.value = null
  scheduleReadiness()
}, { deep: true })

function stopCollection(reason: HistoryCollectionStopReason = 'user') {
  if (!props.archiveAdapter.collectionInsideExportOnly || !collecting.value) return
  const request: HistoryLoaderStopRequest = {
    conversationId: props.conversationId, reason,
    ...(collectionSessionId.value !== undefined ? { sessionId: collectionSessionId.value } : {}),
  }
  if (props.archiveAdapter.stopCollection) props.archiveAdapter.stopCollection(request)
  else window.dispatchEvent(new CustomEvent(HISTORY_LOADER_STOP_EVENT, { detail: request }))
  // Service events are authoritative where available; legacy adapter keeps its old UI state.
  if (!props.archiveAdapter.getCollectionState) {
    collecting.value = false
    refreshing.value = false
    collectionPaused.value = true
    collectionSaving.value = false
    collectionStopReason.value = reason
  }
}
// The modal stays mounted behind Archive so its wizard state survives Back.
// A hidden modal must nevertheless stop native collection immediately.
watch(() => props.suspended, (hidden) => {
  if (hidden) {
    stopCollection('export_suspended')
    cancelExport()
    readinessController?.abort()
    clearTimeout(readinessTimer)
  } else {
    scheduleReadiness()
    if (previewOpen.value) void loadPreview()
    if (!preferenceContext.value && ready.value) void changePreferenceScope()
  }
})
function collectionStateChanged(event: Event) {
  applyCollectionState((event as CustomEvent<HistoryLoaderState>).detail)
}
function applyCollectionState(status: Readonly<HistoryLoaderState> | undefined) {
  if (!props.archiveAdapter.collectionInsideExportOnly || !status ||
      status.conversationId !== props.conversationId) return
  if (collectionSessionId.value !== undefined && status.sessionId !== undefined &&
      status.sessionId < collectionSessionId.value) return
  collectionSessionId.value = status.sessionId
  collectionSaving.value = status.phase === 'saving'
  collectionStopReason.value = status.stopReason
  if (['preparing', 'scrolling', 'waiting_for_load', 'backoff', 'saving'].includes(status.phase)) {
    collecting.value = true
    refreshing.value = true
    collectionPaused.value = false
    return
  }
  if (status.phase === 'complete' || status.phase === 'cancelled' || status.phase === 'error') {
    collecting.value = false
    refreshing.value = false
    collectionPaused.value = status.phase !== 'complete'
    if (status.phase === 'error') error.value = status.message ?? 'archive.error.unknown'
    preview.value = undefined
    failedBlocker.value = null
    scheduleReadiness()
    if (previewOpen.value && !props.suspended) void loadPreview()
    void props.archiveAdapter.getCoverage(props.conversationId).then((next) => {
      if (active) coverage.value = next
    }).catch(() => undefined)
  }
}
function onVisibilityChange() {
  if (document.hidden) stopCollection('tab_hidden')
  else if (!busy.value) scheduleReadiness()
}
function closeDialog() {
  stopCollection('export_closed')
  stopExport(false)
  clearPrepared()
  emit('close')
}
async function togglePreview() {
  if (!props.archiveAdapter.getExportPreview) return
  previewOpen.value = !previewOpen.value
  if (!previewOpen.value || preview.value) return
  await loadPreview()
}
async function loadPreview() {
  if (!props.archiveAdapter.getExportPreview) return
  const ticket = ++previewRevision
  previewLoading.value = true
  previewError.value = false
  try {
    const result = await props.archiveAdapter.getExportPreview(props.conversationId)
    if (active && ticket === previewRevision) preview.value = result
  } catch {
    if (active && ticket === previewRevision) previewError.value = true
  } finally {
    if (active && ticket === previewRevision) previewLoading.value = false
  }
}
function openFullArchive() {
  stopCollection('export_suspended')
  cancelExport()
  emit('open-archive', props.conversationId)
}
function inspectPreviewMessage(location: ArchiveMessageLocation | undefined) {
  if (!location || busy.value || previewLoading.value || !props.archiveAdapter.getMessageWindow) return
  if (props.archiveAdapter.currentAccountId?.() !== location.accountId) {
    error.value = 'archive.error.auth'
    return
  }
  stopCollection('export_suspended')
  cancelExport()
  emit('open-archive', props.conversationId, { ...location })
}

function onSourceIncompatible(event: Event) {
  const conversationId = (event as CustomEvent<{ conversationId?: string }>).detail?.conversationId
  if (conversationId !== props.conversationId) return
  incompatible.value = true
  stopExport(false)
  clearPrepared()
  error.value = 'archive.error.incompatibleSource'
  failedBlocker.value = 'source_incompatible'
  scheduleReadiness()
}
onMounted(async () => {
  void checkRecovered()
  window.addEventListener(ARCHIVE_SOURCE_INCOMPATIBLE_EVENT, onSourceIncompatible)
  window.addEventListener(HISTORY_LOADER_STATE_EVENT, collectionStateChanged)
  applyCollectionState(props.archiveAdapter.getCollectionState?.())
  document.addEventListener('visibilitychange', onVisibilityChange)
  unsubscribeContext = props.archiveAdapter.subscribeContextChange?.(() => {
    contextRevision.value += 1
    preferenceRevision += 1
    preferenceContext.value = undefined
    if (collecting.value) stopCollection('navigation')
    invalidateExportSource()
    void checkRecovered()
    if (ready.value && !props.suspended) void changePreferenceScope()
  })
  unsubscribeExport = props.archiveAdapter.subscribeExportChanges?.(
    props.conversationId, invalidateExportSource,
  )
  try {
    const [settings, nextCoverage, scoped] = await Promise.all([
      props.settingsAdapter.get(),
      props.archiveAdapter.getExportReadiness ? undefined
        : props.archiveAdapter.getCoverage(props.conversationId),
      props.archiveAdapter.getExportPreferences?.(props.conversationId).catch(() => undefined),
    ])
    if (active) {
      const normalized = normalizeExportOptions(scoped?.options ?? settings.export)
      preferenceSource.value = scoped?.source ?? 'global'
      preferenceScope.value = scoped?.source ?? 'global'
      preferenceHasProject.value = !!scoped?.projectId
      preferenceContext.value = scoped ? { accountId: scoped.accountId, projectId: scoped.projectId } : undefined
      formats.value = props.archiveAdapter.listExportFormats()
      const selected = formats.value.find((format) => format.id === normalized.format)
      const fallback = formats.value.find((format) => format.isDefault) ?? formats.value[0]
      options.value = {
        ...normalized,
        format: selected?.id ?? fallback?.id ?? DEFAULT_EXPORT_OPTIONS.format,
      }
      if (props.archiveAdapter.archiveGeneration === 4 && options.value.level === 'full' &&
        options.value.format !== 'json' && options.value.format !== 'json-compact')
        options.value.format = 'json'
      coverage.value = nextCoverage
      incompatible.value = !!props.archiveAdapter.hasIncompatibleSource?.(props.conversationId)
      ready.value = true
      let captureSignature = JSON.stringify([settings.enabled, settings.archive])
      unsubscribeCapturePolicy = props.settingsAdapter.subscribe((next) => {
        const signature = JSON.stringify([next.enabled, next.archive])
        if (captureSignature === signature) return
        captureSignature = signature
        invalidateExportSource()
      })
      await refreshReadiness()
    }
  } catch {
    error.value = 'common.saveError'
  }
})
onBeforeUnmount(() => {
  ++recoveredRevision
  ++previewRevision
  ++preferenceRevision
  stopCollection('export_closed')
  window.removeEventListener(ARCHIVE_SOURCE_INCOMPATIBLE_EVENT, onSourceIncompatible)
  window.removeEventListener(HISTORY_LOADER_STATE_EVENT, collectionStateChanged)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  unsubscribeContext?.()
  unsubscribeExport?.()
  unsubscribeCapturePolicy?.()
  readinessController?.abort()
  clearTimeout(readinessTimer)
  active = false
  stopExport(false)
  clearPrepared()
})
function clearPrepared() {
  if (preparedUrl.value) URL.revokeObjectURL(preparedUrl.value)
  preparedUrl.value = ''
  preparedName.value = ''
  preparedBytes.value = null
  complete.value = false
  incomplete.value = false
}
async function changePreferenceScope() {
  if (!props.archiveAdapter.getExportPreferences) return
  const scope = preferenceScope.value
  const ticket = ++preferenceRevision
  preferenceLoading.value = true
  try {
    await queue
    const resolved = await props.archiveAdapter.getExportPreferences(props.conversationId, scope)
    if (!active || ticket !== preferenceRevision || preferenceScope.value !== scope) return
    const supported = props.archiveAdapter.listExportFormats()
    const normalized = normalizeExportOptions(resolved.options)
    if (!supported.some((format) => format.id === normalized.format))
      normalized.format = supported.find((format) => format.isDefault)?.id ?? DEFAULT_EXPORT_OPTIONS.format
    if (props.archiveAdapter.archiveGeneration === 4 && normalized.level === 'full' &&
        normalized.format !== 'json' && normalized.format !== 'json-compact') normalized.format = 'json'
    options.value = normalized
    preferenceSource.value = resolved.source
    preferenceContext.value = { accountId: resolved.accountId, projectId: resolved.projectId }
    preferenceHasProject.value = !!resolved.projectId
    clearPrepared()
    scheduleReadiness()
  } catch {
    if (active && ticket === preferenceRevision) error.value = 'common.saveError'
  } finally {
    if (active && ticket === preferenceRevision) preferenceLoading.value = false
  }
}

function remember() {
  if (props.archiveAdapter.archiveGeneration === 4 && options.value.level === 'full' &&
    options.value.format !== 'json' && options.value.format !== 'json-compact')
    options.value.format = 'json'
  const next = { ...options.value }
  const scope = preferenceScope.value
  const context = preferenceContext.value ? { ...preferenceContext.value } : undefined
  clearPrepared()
  error.value = ''; complete.value = false; incomplete.value = false
  preferenceSaving.value = true
  queue = queue.then(async () => {
    if (props.archiveAdapter.saveExportPreferences) {
      if (!context || !active || preferenceContext.value?.accountId !== context.accountId ||
          preferenceContext.value?.projectId !== context.projectId) throw new Error('archive.error.auth')
      await props.archiveAdapter.saveExportPreferences(props.conversationId, scope, next, context)
      preferenceSource.value = scope
    } else {
      await props.settingsAdapter.update({ export: next })
    }
  }).catch(() => {
    if (active) error.value = 'common.saveError'
  }).finally(() => {
    if (active) preferenceSaving.value = false
  })
}

async function resetPreferenceScope() {
  if (!props.archiveAdapter.saveExportPreferences ||
      !props.archiveAdapter.getExportPreferences || preferenceScope.value === 'global') return
  const scope = preferenceScope.value
  const context = preferenceContext.value ? { ...preferenceContext.value } : undefined
  const ticket = ++preferenceRevision
  preferenceSaving.value = true
  error.value = ''
  try {
    await queue
    if (!context || !active || ticket !== preferenceRevision ||
        preferenceContext.value?.accountId !== context.accountId ||
        preferenceContext.value?.projectId !== context.projectId) throw new Error('archive.error.auth')
    await props.archiveAdapter.saveExportPreferences(props.conversationId, scope, null, context)
    const effective = await props.archiveAdapter.getExportPreferences(props.conversationId)
    if (!active || ticket !== preferenceRevision) return
    options.value = normalizeExportOptions(effective.options)
    preferenceSource.value = effective.source
    preferenceScope.value = effective.source
    preferenceContext.value = { accountId: effective.accountId, projectId: effective.projectId }
    clearPrepared()
  } catch {
    if (active) error.value = 'common.saveError'
  } finally {
    if (active) preferenceSaving.value = false
  }
}
async function refreshBeforeExport() {
  if (!isCurrent.value || refreshing.value || collecting.value || busy.value) return
  refreshing.value = true
  error.value = ''
  try {
    if (props.archiveAdapter.getExportReadiness) {
      await refreshReadiness(true)
      if (!active || props.suspended || collectionDisabled.value) {
        refreshing.value = false
        return
      }
    }
    clearPrepared()
    await props.archiveAdapter.collectCurrent()
    if (props.archiveAdapter.getCollectionState)
      applyCollectionState(props.archiveAdapter.getCollectionState())
    else if (props.archiveAdapter.collectionInsideExportOnly) {
      collecting.value = true
      collectionPaused.value = false
    } else emit('close')
  } catch (cause) {
    const key = cause instanceof Error ? cause.message : ''
    error.value = key.startsWith('archive.error.') ? key : 'archive.error.unknown'
    refreshing.value = false
  }
}
async function download() {
  if (busy.value || !ready.value || collecting.value || refreshing.value ||
      preferenceLoading.value || preferenceSaving.value || props.suspended || prepareBlocked.value) return
  if (props.archiveAdapter.hasIncompatibleSource?.(props.conversationId)) {
    error.value = 'archive.error.incompatibleSource'
    return
  }
  const controller = new AbortController()
  const conversationId = props.conversationId
  const requestedOptions = { ...effectiveOptions.value }
  const requestedName = filename.value
  exportController = controller
  clearPrepared()
  exportCancelled.value = false
  exportProgress.value = { phase: 'checking', unit: null, completed: null, total: null }
  busy.value = true
  error.value = ''
  const ownsRun = () => active && exportController === controller &&
    !controller.signal.aborted && props.conversationId === conversationId && !props.suspended
  const requireRun = () => {
    if (!ownsRun()) throw new DOMException('Export cancelled', 'AbortError')
  }
  try {
    await queue
    requireRun()
    if (!props.archiveAdapter.saveExportPreferences) {
      await props.settingsAdapter.update({ export: requestedOptions })
      requireRun()
    }
    const outcome = await props.archiveAdapter.exportConversation(
      conversationId, requestedOptions, controller.signal,
      (progress) => { if (ownsRun()) exportProgress.value = progress },
    )
    // Closing the wizard or starting another export must not publish this Blob
    // or create an object URL for a no-longer-owned result.
    requireRun()
    const base = requestedName.replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 100) || 'conversation'
    preparedUrl.value = URL.createObjectURL(outcome.blob)
    preparedName.value = `${base}.${outcome.extension}`
    preparedBytes.value = outcome.blob.size
    complete.value = true
    incomplete.value = !outcome.complete
  } catch (cause) {
    if (!ownsRun()) return
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      exportCancelled.value = true
    } else if (cause instanceof ArchiveExportBlockedError) {
      failedBlocker.value = cause.reason
    } else {
      error.value = cause instanceof Error && [
        'archive.error.incompatibleSource', 'archive.error.unverifiedPath',
        'archive.error.sourceChanged',
        'archive.error.technicalRequiresJson', 'archive.error.assetsUnverified',
        'archive.error.auth',
      ].includes(cause.message) ? cause.message : 'export.failed'
    }
  } finally {
    if (exportController === controller) {
      exportController = undefined
      busy.value = false
      exportProgress.value = null
      scheduleReadiness()
    }
  }
}
function stopExport(showCancelled: boolean) {
  const controller = exportController
  if (!controller) return
  // Detach before aborting: old callbacks/finally blocks cannot touch a new run.
  exportController = undefined
  controller.abort()
  busy.value = false
  exportProgress.value = null
  if (active) exportCancelled.value = showCancelled
}
function cancelExport() {
  stopExport(true)
}

</script>
<template>
  <section class="booster-export-dialog" :lang="locale">
    <header class="booster-section-header"><div><strong>{{ t('export.title') }}</strong><p>{{ title || t('identity.untitled') }}</p></div><button type="button" class="booster-icon-button" :aria-label="t('common.close')" @click="closeDialog"><X class="size-4" /></button></header>
    <section v-if="recoveredAvailable" class="booster-export-readiness">
      <header><strong>{{ locale === 'ru' ? 'Скачать сохранённые сообщения' : 'Download saved messages' }}</strong></header>
      <p class="booster-note">{{ locale === 'ru'
        ? 'Перенесённые записи доступны без подтверждённой полноты истории. Файл помечен как неполный; неизвестные страницы и вложения не считаются сохранёнными.'
        : 'Migrated records can be downloaded without verified history completeness. The file is marked partial; missing pages and attachment bytes are not claimed.' }}</p>
      <div class="booster-export-recovery-actions">
        <button type="button" class="booster-action-primary" :disabled="recoveredBusy || suspended"
          @click="downloadRecovered('json-gzip')"><Download class="size-4" />{{ locale === 'ru' ? 'Скачать JSON.gz (сжатый)' : 'Download JSON.gz (compressed)' }}</button>
        <button type="button" class="booster-action-secondary" :disabled="recoveredBusy || suspended"
          @click="downloadRecovered('json')"><Download class="size-4" />{{ locale === 'ru' ? 'JSON без сжатия' : 'JSON uncompressed' }}</button>
        <button type="button" class="booster-action-secondary" :disabled="recoveredBusy || suspended"
          @click="downloadRecovered('markdown')"><Download class="size-4" />{{ locale === 'ru' ? 'Скачать Markdown (неполный)' : 'Download Markdown (partial)' }}</button>
      </div>
      <p v-if="recoveredError" role="alert" class="booster-error">{{ recoveredError }}</p>
    </section>
    <div v-if="ready" class="booster-form-body">
      <div class="booster-export-status" :class="{ warning: updateRecommended }">
        <CheckCircle2 v-if="savedPathVerified && !updateRecommended" class="size-4" />
        <Info v-else class="size-4" />
        <div><strong>{{ t(statusKey) }}</strong><span v-if="readiness">{{ t('export.savedRecordCount') }}: {{ readiness.knownRecordCount }}</span><span v-else-if="!archiveAdapter.getExportReadiness && coverage">{{ t('dock.messages') }}: {{ coverage.visibleMessageCount ?? 0 }} · {{ t('dock.details') }}: {{ coverage.internalRecordCount ?? 0 }}</span></div>
        <button v-if="updateRecommended" type="button" class="booster-action-secondary" :disabled="refreshing || busy || collectionDisabled" @click="refreshBeforeExport"><ArrowUpToLine class="size-4" />{{ t(refreshing ? 'export.refreshStarting' : 'export.refreshFirst') }}</button>
      </div>
      <details v-if="archiveAdapter.getExportReadiness" class="booster-export-disclosure">
        <summary>{{ locale === 'ru' ? 'Подробности проверки полноты' : 'Completeness details' }}
          <small v-if="activeBlockers.length">{{ activeBlockers.length }} {{ locale === 'ru' ? 'ограничений' : 'blockers' }}</small>
        </summary>
      <section class="booster-export-readiness" :aria-busy="readinessLoading">
        <header><strong>{{ t('export.inspectTitle') }}</strong><button type="button" class="booster-action-secondary" :disabled="busy || collecting || readinessLoading" @click="recheckExport">{{ t('export.inspectRefresh') }}</button></header>
        <p v-if="readinessLoading" role="status" class="booster-note">{{ t('export.inspectLoading') }}</p>
        <p v-else-if="readinessFailed" role="alert" class="booster-error">{{ t('export.inspectFailed') }}</p>
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
            <button v-if="captureSettingsAvailable" type="button" class="booster-action-secondary" :disabled="busy || collecting" @click="openCaptureSettings">{{ t('export.inspectCaptureSettings') }}</button>
            <button v-if="activeBlockers.includes('assets_unverified')" type="button" class="booster-action-secondary" :disabled="busy" @click="omitUnavailableFiles">{{ t('export.inspectNoFiles') }}</button>
            <button v-if="activeBlockers.includes('technical_requires_json')" type="button" class="booster-action-secondary" :disabled="busy" @click="selectTechnicalJson">{{ t('export.inspectUseJson') }}</button>
            <button v-if="activeBlockers.length && readiness.knownRecordCount" type="button" class="booster-action-secondary" :disabled="busy" @click="openFullArchive">{{ t('export.inspectArchive') }}</button>
          </div>
        </template>
      </section>
      </details>
      <section v-if="archiveAdapter.getExportPreview" class="booster-export-preview">
        <button type="button" class="booster-action-secondary" :disabled="busy" :aria-expanded="previewOpen" @click="togglePreview">
          {{ locale === 'ru' ? (previewOpen ? 'Скрыть предпросмотр' : 'Предпросмотр начала и конца') : (previewOpen ? 'Hide preview' : 'Preview first and last messages') }}
        </button>
        <div v-if="previewOpen" class="booster-export-preview-content">
          <div v-if="previewLoading" class="booster-export-preview-skeleton" role="status">
            <p class="booster-note">{{ t('reader.loading') }}</p>
            <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
          </div>
          <p v-else-if="previewError" role="alert" class="booster-error">{{ t('reader.error') }}</p>
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
              <button v-if="message.location && archiveAdapter.getMessageWindow" type="button" class="booster-action-secondary" :disabled="busy || collecting || previewLoading" @click="inspectPreviewMessage(message.location)">{{ t('export.inspectMessage') }}</button>
            </div>
            <p v-if="preview.hiddenKnownCount" class="booster-note">… {{ preview.hiddenKnownCount }} {{ locale === 'ru' ? 'промежуточных записей скрыто' : 'middle records hidden' }} …</p>
            <p v-if="previewTail.length" class="booster-note">{{ locale === 'ru' ? 'Последние известные' : 'Latest known' }}</p>
            <div v-for="message in previewTail" :key="'last-'+message.messageId" class="booster-note booster-export-preview-record">
              <span><strong>{{ message.role ?? 'unknown' }}</strong> — {{ message.text || (locale === 'ru' ? 'Нет текстового содержимого' : 'No text') }}</span>
              <button v-if="message.location && archiveAdapter.getMessageWindow" type="button" class="booster-action-secondary" :disabled="busy || collecting || previewLoading" @click="inspectPreviewMessage(message.location)">{{ t('export.inspectMessage') }}</button>
            </div>
            <button type="button" class="booster-action-secondary" @click="openFullArchive">
              {{ locale === 'ru' ? 'Полный архив' : 'Full archive' }}
            </button>
          </template>
        </div>
      </section>
      <details class="booster-export-disclosure">
        <summary>{{ locale === 'ru' ? 'Дополнительные настройки' : 'Advanced settings' }}
          <small v-if="options.packaging === 'zip'">ZIP</small>
        </summary>
      <section v-if="archiveAdapter.saveExportPreferences" class="booster-export-preferences">
        <label>{{ locale === 'ru' ? 'Сохранять настройки для' : 'Save preferences for' }}
          <select v-model="preferenceScope" :disabled="busy || preferenceSaving || preferenceLoading" @change="changePreferenceScope">
            <option value="global">{{ locale === 'ru' ? 'По умолчанию (все чаты)' : 'Global default' }}</option>
            <option value="project" :disabled="!preferenceHasProject">{{ locale === 'ru' ? 'Проект' : 'Project' }}</option>
            <option value="conversation">{{ locale === 'ru' ? 'Этот диалог' : 'This conversation' }}</option>
          </select>
        </label>
        <p class="booster-note">
          {{ locale === 'ru' ? 'Сейчас применяется уровень' : 'Currently inherited from' }}:
          {{ preferenceSource === 'global' ? (locale === 'ru' ? 'общий' : 'global') :
             preferenceSource === 'project' ? (locale === 'ru' ? 'проект' : 'project') :
             (locale === 'ru' ? 'диалог' : 'conversation') }}
        </p>
        <button v-if="preferenceScope !== 'global'" type="button" class="booster-action-secondary"
          :disabled="busy || preferenceSaving" @click="resetPreferenceScope">
          {{ locale === 'ru' ? 'Убрать переопределение' : 'Reset override' }}
        </button>
      </section>
      <label>{{ t('export.format') }}<select v-model="options.format" :disabled="busy || preferenceLoading" @change="remember"><option v-for="format in formats" :key="format.id" :value="format.id">{{ format.label }}</option></select></label>
      <label v-if="archiveAdapter.archiveGeneration === 4">
        {{ locale === 'ru' ? 'Упаковка результата' : 'Output packaging' }}
        <select v-model="options.packaging" :disabled="busy || preferenceLoading" @change="remember">
          <option value="none">{{ locale === 'ru' ? 'Без упаковки' : 'None' }}</option>
          <option value="zip">{{ locale === 'ru' ? 'ZIP (без сжатия)' : 'ZIP (stored, no compression)' }}</option>
          <option value="gzip">{{ locale === 'ru' ? 'GZIP (сжатие, .gz)' : 'GZIP (compressed, .gz)' }}</option>
        </select>
      </label>
      <p v-if="archiveAdapter.archiveGeneration === 4 && options.packaging === 'zip'" class="booster-note">
        {{ locale === 'ru' ? 'ZIP включает файл экспорта и archive-manifest.json, но не бинарные вложения. Сжатие не применяется.' : 'ZIP contains the export and archive-manifest.json, not binary attachments. No compression is applied.' }}
      </p>
      <p v-if="archiveAdapter.archiveGeneration === 4 && options.packaging === 'gzip'" class="booster-note">{{ locale === 'ru' ? 'GZIP без потерь уменьшает размер файла; распаковывается стандартными архиваторами.' : 'Lossless GZIP reduces output size and can be opened by standard archive tools.' }}</p>
      </details>
      <label>{{ t('export.level') }}<select v-model="options.level" :disabled="busy || preferenceLoading" @change="remember"><option value="conversation">{{ t('export.conversation') }}</option><option value="custom">{{ t('export.custom') }}</option><option value="full">{{ t('export.full') }}</option></select></label>
      <p class="booster-note">{{ t(options.level === 'full' ? 'export.profileFull' : options.level === 'custom' ? 'export.profileCustom' : 'export.profileConversation') }}</p>
      <p v-if="archiveAdapter.archiveGeneration === 4 && options.level !== 'full' && (options.format === 'json' || options.format === 'json-compact')" class="booster-note">{{ t('export.timebaseHint') }}</p>
      <fieldset v-if="options.level === 'custom'" :disabled="busy" class="booster-checkboxes">
        <label><input v-model="options.reasoning" type="checkbox" @change="remember" />{{ t('export.reasoning') }}</label>
        <div v-if="archiveAdapter.archiveGeneration === 4 && options.reasoning" class="booster-export-suboptions">
          <label><input v-model="options.reasoningRecap" type="checkbox" @change="remember" />{{ t('export.reasoningRecap') }}</label>
          <label><input v-model="options.reasoningFull" type="checkbox" @change="remember" />{{ t('export.reasoningFull') }}</label>
        </div>
        <label><input v-model="options.tools" type="checkbox" @change="remember" />{{ t('export.tools') }}</label>
        <div v-if="archiveAdapter.archiveGeneration === 4 && options.tools" class="booster-export-suboptions">
          <label><input v-model="options.toolCalls" type="checkbox" @change="remember" />{{ t('export.toolCalls') }}</label>
          <label><input v-model="options.toolResults" type="checkbox" @change="remember" />{{ t('export.toolResults') }}</label>
          <label><input v-model="options.toolSourceContent" type="checkbox" @change="remember" />{{ t('export.toolSourceContent') }}</label>
        </div>
        <label><input v-model="options.internal" type="checkbox" @change="remember" />{{ t('export.internal') }}</label>
        <template v-if="archiveAdapter.archiveGeneration === 4">
          <label><input v-model="options.modelEvidence" type="checkbox" @change="remember" />{{ t('export.modelEvidence') }}</label>
          <p v-if="options.modelEvidence" class="booster-note">{{ t('export.modelEvidenceScope') }}</p>
          <label><input v-model="options.dictationEditEvidence" type="checkbox" @change="remember" />{{ t('export.dictationEditEvidence') }}</label>
          <label><input v-model="options.sourceRevisions" type="checkbox" @change="remember" />{{ t('export.sourceRevisions') }}</label>
          <label><input v-model="options.attachmentMetadata" type="checkbox" @change="remember" />{{ t('export.attachmentMetadata') }}</label>
          <p class="booster-note">{{ t('export.evidenceWarning') }}</p>
        </template>
        <label><input v-model="options.images" type="checkbox" @change="remember" />{{ t('export.images') }}</label><label><input v-model="options.files" type="checkbox" @change="remember" />{{ t('export.files') }}</label>
      </fieldset>
      <fieldset v-if="options.level === 'full'" :disabled="busy" class="booster-checkboxes">
        <label><input v-model="options.images" type="checkbox" @change="remember" />{{ t('export.images') }}</label>
        <label><input v-model="options.files" type="checkbox" @change="remember" />{{ t('export.files') }}</label>
      </fieldset>
      <p v-if="collecting" class="booster-note" role="status">{{ t(collectionSaving ? 'export.collectionSaving' : 'export.collectionLoading') }} <button type="button" class="booster-action-secondary" @click="stopCollection('user')">{{ t('dock.stop') }}</button></p>
      <p v-if="collectionPaused" class="booster-note">{{ collectionPauseLabel }} {{ t('export.collectionResumeExplicit') }}</p>
      <p v-if="incompatible" role="alert" class="booster-error">{{ t("archive.error.incompatibleSource") }}</p>
      <p v-if="wantsAssets" class="booster-note">{{ t('export.metadata') }}</p>
      <p v-if="wantsAssets" class="booster-notice">{{ t('export.binaryUnavailable') }}</p>
      <p class="booster-note">{{ t('export.remember') }}</p>
      <p v-if="error && !incompatible" role="alert" class="booster-error">{{ t(error as TranslationKey) }}</p><p v-if="complete" role="status">{{ t(incomplete ? 'export.savedPartial' : 'export.saved') }}</p>
      <label>{{ locale === 'ru' ? 'Имя файла' : 'Filename' }} <input v-model="filename" type="text" :disabled="busy" maxlength="100" /></label>
      <ArchiveProgress v-if="busy && exportProgress" :label="exportPhaseLabel" :busy="busy"
        :completed="exportProgress.completed" :total="exportProgress.total" :detail="exportCounter" />
      <p v-if="exportCancelled" class="booster-note" role="status">{{ t('export.cancelled') }}</p>
      <p v-if="preparedUrl && preparedBytes !== null" class="booster-note">{{ t('export.preparedSize') }}: {{ formatExportBytes(preparedBytes) }}</p>
      <a v-if="preparedUrl" class="booster-action-primary booster-export-ready" :href="prepareBlocked ? undefined : preparedUrl" :aria-disabled="prepareBlocked" :download="preparedName" @click="prepareBlocked && $event.preventDefault()"><Download class="size-4" />{{ t('export.readyDownload') }}</a>
      <button v-else-if="!recoveredAvailable || !prepareBlocked" class="booster-action-primary" type="button" :disabled="busy || incompatible || collecting || refreshing || preferenceLoading || preferenceSaving || prepareBlocked" @click="download"><Download class="size-4" />{{ t(busy ? 'export.working' : 'export.prepare') }}</button>
      <button v-if="busy" class="booster-action-secondary" type="button" @click="cancelExport">{{ t('common.cancel') }}</button>
    </div><p v-else class="booster-note">{{ t(error ? 'common.saveError' : 'control.loading') }}</p>
  </section>
</template>
