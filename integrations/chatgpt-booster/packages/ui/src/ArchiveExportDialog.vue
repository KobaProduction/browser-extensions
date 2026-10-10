<script setup lang="ts">
import {
  ARCHIVE_SOURCE_INCOMPATIBLE_EVENT,
  ArchiveExportBlockedError,
  type ArchiveExportReadiness,
  type ArchiveExportBlocker,
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
import { ArchiveProgressBar } from '@kobaproduction/browser-widgets'
import { translate, type SupportedLocale, type TranslationKey } from './i18n'
import ArchiveExportOptionsPanel from './ArchiveExportOptions.vue'
import ArchiveExportPreferences from './ArchiveExportPreferences.vue'
import ArchiveExportReadinessPanel from './ArchiveExportReadiness.vue'
import ArchiveExportPreviewPanel from './ArchiveExportPreview.vue'
import type { ArchiveCoverageView, ArchiveDataAdapter, ArchiveExportPreview } from './mount'
const props = defineProps<{ archiveAdapter: ArchiveDataAdapter; settingsAdapter: SettingsAdapter; conversationId: string; title?: string | null; locale: SupportedLocale; suspended?: boolean }>()
const emit = defineEmits<{ close: []; 'open-archive': [conversationId: string, location?: ArchiveMessageLocation]; 'open-capture': [context: ArchiveCaptureContext] }>()
const options = ref<ArchiveExportOptions>({ ...DEFAULT_EXPORT_OPTIONS })
function updateExportOptions(next:ArchiveExportOptions){
  options.value=next
  remember()
}

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
const previewOpen = ref(false)
const previewLoading = ref(false)
const preview = ref<ArchiveExportPreview>()
const previewError = ref(false)
let previewRevision = 0
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
const exportStagePercent = computed(() => {
  const progress = exportProgress.value
  if (!progress || progress.total === null || progress.completed === null || progress.total <= 0)
    return null
  return Math.min(100, Math.floor(100 * progress.completed / progress.total))
})
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
async function changePreferenceScopeFromView(scope:ExportPreferenceScope){
  preferenceScope.value=scope
  await changePreferenceScope()
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
    <div v-if="ready" class="booster-form-body">
      <div class="booster-export-status" :class="{ warning: updateRecommended }">
        <CheckCircle2 v-if="savedPathVerified && !updateRecommended" class="size-4" />
        <Info v-else class="size-4" />
        <div><strong>{{ t(statusKey) }}</strong><span v-if="readiness">{{ t('export.savedRecordCount') }}: {{ readiness.knownRecordCount }}</span><span v-else-if="!archiveAdapter.getExportReadiness && coverage">{{ t('dock.messages') }}: {{ coverage.visibleMessageCount ?? 0 }} · {{ t('dock.details') }}: {{ coverage.internalRecordCount ?? 0 }}</span></div>
        <button v-if="updateRecommended" type="button" class="booster-action-secondary" :disabled="refreshing || busy || collectionDisabled" @click="refreshBeforeExport"><ArrowUpToLine class="size-4" />{{ t(refreshing ? 'export.refreshStarting' : 'export.refreshFirst') }}</button>
      </div>
      <ArchiveExportReadinessPanel
        v-if="archiveAdapter.getExportReadiness"
        :readiness="readiness"
        :loading="readinessLoading"
        :failed="readinessFailed"
        :active-blockers="activeBlockers"
        :busy="busy"
        :collecting="collecting"
        :capture-settings-available="captureSettingsAvailable"
        :capture-excluded="captureExcluded"
        :locale="locale"
        @recheck="recheckExport"
        @capture-settings="openCaptureSettings"
        @omit-assets="omitUnavailableFiles"
        @use-json="selectTechnicalJson"
        @open-archive="openFullArchive"
      />
      <ArchiveExportPreviewPanel
        v-if="archiveAdapter.getExportPreview"
        :open="previewOpen"
        :loading="previewLoading"
        :failed="previewError"
        :preview="preview"
        :can-navigate="!!archiveAdapter.getMessageWindow"
        :busy="busy"
        :collecting="collecting"
        :locale="locale"
        @toggle="togglePreview"
        @inspect-message="inspectPreviewMessage"
        @open-archive="openFullArchive"
      />
      <ArchiveExportPreferences
        v-if="archiveAdapter.saveExportPreferences"
        :scope="preferenceScope"
        :source="preferenceSource"
        :has-project="preferenceHasProject"
        :saving="preferenceSaving"
        :loading="preferenceLoading"
        :busy="busy"
        :locale="locale"
        @update:scope="changePreferenceScopeFromView"
        @reset="resetPreferenceScope"
      />
      <ArchiveExportOptionsPanel
        :options="options"
        :formats="formats"
        :archive-generation="archiveAdapter.archiveGeneration"
        :busy="busy"
        :preference-loading="preferenceLoading"
        :locale="locale"
        @change="updateExportOptions"
      />
      <p v-if="collecting" class="booster-note" role="status">{{ t(collectionSaving ? 'export.collectionSaving' : 'export.collectionLoading') }} <button type="button" class="booster-action-secondary" @click="stopCollection('user')">{{ t('dock.stop') }}</button></p>
      <p v-if="collectionPaused" class="booster-note">{{ collectionPauseLabel }} {{ t('export.collectionResumeExplicit') }}</p>
      <p v-if="incompatible" role="alert" class="booster-error">{{ t("archive.error.incompatibleSource") }}</p>
      <p v-if="wantsAssets" class="booster-note">{{ t('export.metadata') }}</p>
      <p v-if="wantsAssets" class="booster-notice">{{ t('export.binaryUnavailable') }}</p>
      <p class="booster-note">{{ t('export.remember') }}</p>
      <p v-if="error && !incompatible" role="alert" class="booster-error">{{ t(error as TranslationKey) }}</p><p v-if="complete" role="status">{{ t(incomplete ? 'export.savedPartial' : 'export.saved') }}</p>
      <label>{{ locale === 'ru' ? 'Имя файла' : 'Filename' }} <input v-model="filename" type="text" :disabled="busy" maxlength="100" /></label>
      <ArchiveProgressBar v-if="busy && exportProgress"
        :label="exportPhaseLabel"
        :percent="exportStagePercent"
        :counter="exportCounter"
        :percent-label="t('export.progressStage')"
      />
      <p v-if="exportCancelled" class="booster-note" role="status">{{ t('export.cancelled') }}</p>
      <p v-if="preparedUrl && preparedBytes !== null" class="booster-note">{{ t('export.preparedSize') }}: {{ formatExportBytes(preparedBytes) }}</p>
      <a v-if="preparedUrl" class="booster-action-primary booster-export-ready" :href="prepareBlocked ? undefined : preparedUrl" :aria-disabled="prepareBlocked" :download="preparedName" @click="prepareBlocked && $event.preventDefault()"><Download class="size-4" />{{ t('export.readyDownload') }}</a>
      <button v-else class="booster-action-primary" type="button" :disabled="busy || incompatible || collecting || refreshing || preferenceLoading || preferenceSaving || prepareBlocked" @click="download"><Download class="size-4" />{{ t(busy ? 'export.working' : 'export.prepare') }}</button>
      <button v-if="busy" class="booster-action-secondary" type="button" @click="cancelExport">{{ t('common.cancel') }}</button>
    </div><p v-else class="booster-note">{{ t(error ? 'common.saveError' : 'control.loading') }}</p>
  </section>
</template>
