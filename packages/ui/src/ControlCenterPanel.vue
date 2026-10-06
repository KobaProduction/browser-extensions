<script setup lang="ts">
import {
  BOOSTER_VERSION,
  EMPTY_TRANSPORT_COUNTERS,
  type ArchiveCaptureContext,
  type BoosterSettings,
  type BoosterSettingsPatch,
  type DiagnosticsAdapter,
  type LanguagePreference,
  type PersistentDiagnosticsAdapter,
  type SecretAdapter,
  type SettingsAdapter,
  type SettingsSection,
  type TelemetryControlAdapter,
  type TransportCounters,
  mergeSettings,
  snapshotSettings,
} from '@chatgpt-booster/core'
import Activity from 'lucide-vue-next/dist/esm/icons/activity.js'
import AlertTriangle from 'lucide-vue-next/dist/esm/icons/triangle-alert.js'
import ArrowDownLeft from 'lucide-vue-next/dist/esm/icons/arrow-down-left.js'
import ArrowUpRight from 'lucide-vue-next/dist/esm/icons/arrow-up-right.js'
import BarChart3 from 'lucide-vue-next/dist/esm/icons/chart-column.js'
import Check from 'lucide-vue-next/dist/esm/icons/check.js'
import Clock3 from 'lucide-vue-next/dist/esm/icons/clock-3.js'
import ChevronDown from 'lucide-vue-next/dist/esm/icons/chevron-down.js'
import Languages from 'lucide-vue-next/dist/esm/icons/languages.js'
import RefreshCcw from 'lucide-vue-next/dist/esm/icons/refresh-ccw.js'
import Settings2 from 'lucide-vue-next/dist/esm/icons/settings-2.js'
import ShieldCheck from 'lucide-vue-next/dist/esm/icons/shield-check.js'
import SlidersHorizontal from 'lucide-vue-next/dist/esm/icons/sliders-horizontal.js'
import Wrench from 'lucide-vue-next/dist/esm/icons/wrench.js'
import X from 'lucide-vue-next/dist/esm/icons/x.js'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { resolveLocale, translate } from './i18n'
import CaptureSettings from './CaptureSettings.vue'
import ModalSurface from './ModalSurface.vue'
import type { ArchiveDataAdapter } from './mount'

const props = withDefaults(
  defineProps<{
    settingsAdapter: SettingsAdapter
    archiveAdapter?: ArchiveDataAdapter | undefined
    captureContext?: ArchiveCaptureContext | undefined
    diagnosticsAdapter?: DiagnosticsAdapter | undefined
    persistentDiagnosticsAdapter?: PersistentDiagnosticsAdapter | undefined
    secretAdapter?: SecretAdapter | undefined
    telemetryControlAdapter?: TelemetryControlAdapter | undefined
    targetLabel: string
    showClose?: boolean
  }>(),
  { showClose: false },
)

const emit = defineEmits<{ close: [] }>()
const ready = ref(false)
const saving = ref(false)
const saved = ref(false)
const tokenDraft = ref('')
const tokenConfigured = ref(false)
const tokenEditing = ref(false)
const telemetryTestState = ref<'idle' | 'testing' | 'success' | 'error'>('idle')
const telemetryTestError = ref('')
const archiveResetOpen = ref(false)
const archiveResetting = ref(false)
const archiveResetError = ref('')
const counters = ref<TransportCounters>({ ...EMPTY_TRANSPORT_COUNTERS })
const lifetimeCounters = ref<TransportCounters>({ ...EMPTY_TRANSPORT_COUNTERS })
const settings = ref<BoosterSettings>()
let unsubscribe: (() => void) | undefined
let unsubscribeDiagnostics: (() => void) | undefined
let unsubscribeLifetimeDiagnostics: (() => void) | undefined
let savedTimer: number | undefined
let localRevision = 0
let pendingWrites = 0

const locale = computed(() => resolveLocale(settings.value?.language ?? 'auto'))
const t = (key: Parameters<typeof translate>[1]) => translate(locale.value, key)
const activeSection = computed(() => settings.value?.ui.activeSection ?? 'modules')
const currentRequestTotal = computed(() => counters.value.requestsSent + counters.value.responsesReceived)
const lifetimeRequestTotal = computed(() => lifetimeCounters.value.requestsSent + lifetimeCounters.value.responsesReceived)
const currentMessageTotal = computed(() => counters.value.messagesSent + counters.value.messagesReceived)
const lifetimeMessageTotal = computed(() => lifetimeCounters.value.messagesSent + lifetimeCounters.value.messagesReceived)
function bar(value: number, total: number) {
  return `${total > 0 ? Math.max(3, Math.round((value / total) * 100)) : 0}%`
}
function activityTime(value: number | null) {
  return value ? new Date(value).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : t('control.noActivity')
}
function resetCurrentAnalytics() {
  props.diagnosticsAdapter?.resetTransport()
}

onMounted(async () => {
  settings.value = snapshotSettings(await props.settingsAdapter.get())
  unsubscribe = props.settingsAdapter.subscribe((next) => {
    if (pendingWrites === 0) settings.value = snapshotSettings(next)
  })

  if (props.diagnosticsAdapter) {
    counters.value = props.diagnosticsAdapter.getTransportCounters()
    unsubscribeDiagnostics = props.diagnosticsAdapter.subscribeTransport((next) => {
      counters.value = next
    })
  }

  if (props.persistentDiagnosticsAdapter) {
    lifetimeCounters.value = await props.persistentDiagnosticsAdapter.getLifetimeTransportCounters()
    unsubscribeLifetimeDiagnostics = props.persistentDiagnosticsAdapter.subscribeLifetimeTransport(
      (next) => {
        lifetimeCounters.value = next
      },
    )
  }

  if (props.secretAdapter) {
    tokenConfigured.value = Boolean(await props.secretAdapter.getTelemetryToken())
  }

  ready.value = true
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribeDiagnostics?.()
  unsubscribeLifetimeDiagnostics?.()
  if (savedTimer) window.clearTimeout(savedTimer)
})

async function applyPatch(patch: BoosterSettingsPatch) {
  if (!settings.value) return

  const revision = ++localRevision
  pendingWrites += 1
  settings.value = mergeSettings(settings.value, patch)
  saving.value = true

  try {
    const persisted = await props.settingsAdapter.update(patch)
    if (revision === localRevision) settings.value = snapshotSettings(persisted)
    saved.value = true
    if (savedTimer) window.clearTimeout(savedTimer)
    savedTimer = window.setTimeout(() => (saved.value = false), 1200)
  } catch (error) {
    console.error('[ChatGPT Booster] Failed to persist settings', error)
    if (revision === localRevision) {
      settings.value = snapshotSettings(await props.settingsAdapter.get())
    }
  } finally {
    pendingWrites -= 1
    if (pendingWrites === 0) saving.value = false
  }
}

async function setLanguage(event: Event) {
  await applyPatch({
    language: (event.target as HTMLSelectElement).value as LanguagePreference,
  })
}

async function setTelemetryEndpoint(event: Event) {
  await applyPatch({
    telemetry: {
      endpoint: (event.target as HTMLInputElement).value.trim(),
    },
  })
  telemetryTestState.value = 'idle'
  telemetryTestError.value = ''
}

async function setSection(section: SettingsSection) {
  await applyPatch({ ui: { activeSection: section } })
}

async function setHistoryScrollSpeed(event: Event) {
  await applyPatch({
    historyLoader: { speedPxPerSecond: Number((event.target as HTMLInputElement).value) },
  })
}

async function setHistoryScrollPause(event: Event) {
  await applyPatch({
    historyLoader: { pauseMs: Number((event.target as HTMLInputElement).value) },
  })
}

async function toggleTelemetryExpanded() {
  if (!settings.value) return
  await applyPatch({ ui: { telemetryExpanded: !settings.value.ui.telemetryExpanded } })
}

async function saveToken() {
  if (!props.secretAdapter) return
  await props.secretAdapter.setTelemetryToken(tokenDraft.value.trim())
  tokenConfigured.value = Boolean(tokenDraft.value.trim())
  tokenDraft.value = ''
  tokenEditing.value = false
  telemetryTestState.value = 'idle'
  telemetryTestError.value = ''
  saved.value = true
}

async function clearArchive() {
  if (!props.archiveAdapter || archiveResetting.value) return
  archiveResetting.value = true
  archiveResetError.value = ''
  try {
    await props.archiveAdapter.clearAll()
    archiveResetOpen.value = false
  } catch (error) {
    console.error('[ChatGPT Booster] Failed to clear local archive', error)
    archiveResetError.value = error instanceof Error ? error.message : String(error)
  } finally {
    archiveResetting.value = false
  }
}

async function testTelemetry() {
  if (!props.telemetryControlAdapter) return
  telemetryTestState.value = 'testing'
  telemetryTestError.value = ''
  try {
    await props.telemetryControlAdapter.test()
    telemetryTestState.value = 'success'
  } catch (error) {
    telemetryTestState.value = 'error'
    telemetryTestError.value = error instanceof Error ? error.message : String(error)
  }
}
</script>

<template>
  <section class="booster-control-center" :lang="locale">
    <header class="booster-control-header">
      <div class="booster-header-copy">
        <div class="flex items-center gap-2">
          <strong>{{ t('control.title') }}</strong>
          <Badge variant="outline">{{ targetLabel }}</Badge>
          <Badge variant="outline" :title="BOOSTER_VERSION">{{ BOOSTER_VERSION }}</Badge>
        </div>
        <p>{{ t('control.subtitle') }}</p>
      </div>

      <div v-if="settings" class="booster-header-actions">
        <span class="booster-header-toggle-label">{{ t('control.booster') }}</span>
        <button
          type="button"
          class="booster-switch"
          :class="{ 'booster-switch-on': settings.enabled }"
          :aria-pressed="settings.enabled"
          @click="applyPatch({ enabled: !settings.enabled })"
        ><span /></button>
        <Button
          v-if="showClose"
          variant="ghost"
          size="icon"
          class="size-8"
          :title="t('common.close')"
          @click="emit('close')"
        ><X class="size-4" /></Button>
      </div>
    </header>

    <div v-if="!ready || !settings" class="booster-loading">{{ t('control.loading') }}</div>

    <div v-else class="booster-settings-layout">
      <nav class="booster-settings-nav">
        <button :class="{ active: activeSection === 'archive' }" @click="setSection('archive')"><ShieldCheck class="size-4" />{{ t('capture.title') }}</button>
        <button
          :class="{ active: activeSection === 'modules' }"
          @click="setSection('modules')"
        ><Wrench class="size-4" />{{ t('control.modules') }}</button>
        <button
          :class="{ active: activeSection === 'analytics' }"
          @click="setSection('analytics')"
        ><BarChart3 class="size-4" />{{ t('control.analytics') }}</button>
        <button
          :class="{ active: activeSection === 'other' }"
          @click="setSection('other')"
        ><SlidersHorizontal class="size-4" />{{ t('control.other') }}</button>
      </nav>

      <main class="booster-settings-content">
        <template v-if="activeSection === 'archive'">
          <CaptureSettings :settings-adapter="settingsAdapter" :archive-adapter="archiveAdapter" :context="captureContext" :locale="locale" />
          <section v-if="archiveAdapter" class="booster-danger-zone">
            <div class="booster-setting-copy">
              <div class="flex items-center gap-2"><AlertTriangle class="size-4" /><b>{{ t('archiveReset.title') }}</b></div>
              <span>{{ t('archiveReset.description') }}</span>
            </div>
            <button type="button" class="booster-destructive-button" @click="archiveResetError = ''; archiveResetOpen = true">
              {{ t('archiveReset.action') }}
            </button>
          </section>
        </template>
        <template v-else-if="activeSection === 'modules'">
          <section class="booster-setting-card" :class="{ 'booster-setting-disabled': !settings.enabled }">
            <div class="booster-setting-copy">
              <div class="flex items-center gap-2">
                <Clock3 class="size-4" />
                <b>{{ t('control.messageMetadata') }}</b>
                <Badge :variant="settings.features.messageMetadata && settings.enabled ? 'default' : 'secondary'">
                  {{ settings.features.messageMetadata && settings.enabled ? t('common.on') : t('common.off') }}
                </Badge>
              </div>
              <span>{{ t('control.messageMetadataDescription') }}</span>
            </div>
            <button
              type="button"
              class="booster-switch"
              :class="{ 'booster-switch-on': settings.features.messageMetadata }"
              :disabled="!settings.enabled"
              @click="applyPatch({ features: { messageMetadata: !settings.features.messageMetadata } })"
            ><span /></button>
          </section>

          <section class="booster-setting-card" :class="{ 'booster-setting-disabled': !settings.enabled }">
            <div class="booster-setting-copy">
              <div class="flex items-center gap-2">
                <Activity class="size-4" />
                <b>{{ t('control.activityIndicator') }}</b>
                <Badge :variant="settings.features.activityIndicator && settings.enabled ? 'default' : 'secondary'">
                  {{ settings.features.activityIndicator && settings.enabled ? t('common.on') : t('common.off') }}
                </Badge>
              </div>
              <span>{{ t('control.activityIndicatorDescription') }}</span>
            </div>
            <button
              type="button"
              class="booster-switch"
              :class="{ 'booster-switch-on': settings.features.activityIndicator }"
              :disabled="!settings.enabled"
              @click="applyPatch({ features: { activityIndicator: !settings.features.activityIndicator } })"
            ><span /></button>
          </section>

          <section class="booster-setting-card" :class="{ 'booster-setting-disabled': !settings.enabled }">
            <div class="booster-setting-copy">
              <div class="flex items-center gap-2">
                <Wrench class="size-4" />
                <b>{{ t('control.toolInspector') }}</b>
                <Badge :variant="settings.features.toolInspector && settings.enabled ? 'default' : 'secondary'">
                  {{ settings.features.toolInspector && settings.enabled ? t('common.on') : t('common.off') }}
                </Badge>
              </div>
              <span>{{ t('control.toolInspectorDescription') }}</span>
            </div>
            <button
              type="button"
              class="booster-switch"
              :class="{ 'booster-switch-on': settings.features.toolInspector }"
              :disabled="!settings.enabled"
              @click="applyPatch({ features: { toolInspector: !settings.features.toolInspector } })"
            ><span /></button>
          </section>

          <section class="booster-setting-card booster-setting-card-stack" :class="{ 'booster-setting-disabled': !settings.enabled }">
            <div class="booster-setting-copy">
              <div class="flex items-center gap-2">
                <SlidersHorizontal class="size-4" />
                <b>{{ t('control.historyScroll') }}</b>
              </div>
              <span>{{ t('control.historyScrollDescription') }}</span>
            </div>
            <div class="booster-range-grid">
              <label>
                <span>{{ t('control.historyScrollSpeed') }} <b>{{ Math.round(settings.historyLoader.speedPxPerSecond) }} px/s</b></span>
                <input type="range" min="600" max="6000" step="100" :value="settings.historyLoader.speedPxPerSecond" @change="setHistoryScrollSpeed" />
              </label>
              <label>
                <span>{{ t('control.historyScrollPause') }} <b>{{ Math.round(settings.historyLoader.pauseMs) }} ms</b></span>
                <input type="range" min="20" max="1200" step="10" :value="settings.historyLoader.pauseMs" @change="setHistoryScrollPause" />
              </label>
            </div>
          </section>

          <section class="booster-setting-card" :class="{ 'booster-setting-disabled': !settings.enabled }">
            <div class="booster-setting-copy">
              <div class="flex items-center gap-2">
                <Activity class="size-4" />
                <b>{{ t('control.observer') }}</b>
                <Badge :variant="settings.observer.enabled && settings.enabled ? 'default' : 'secondary'">
                  {{ settings.observer.enabled && settings.enabled ? t('common.on') : t('common.off') }}
                </Badge>
              </div>
              <span>{{ t('control.observerDescription') }}</span>
            </div>
            <button
              type="button"
              class="booster-switch"
              :class="{ 'booster-switch-on': settings.observer.enabled }"
              :disabled="!settings.enabled"
              @click="applyPatch({ observer: { enabled: !settings.observer.enabled } })"
            ><span /></button>
          </section>

          <section class="booster-setting-card" :class="{ 'booster-setting-disabled': !settings.observer.enabled }">
            <div class="booster-setting-copy">
              <div class="flex items-center gap-2">
                <ShieldCheck class="size-4" />
                <b>{{ t('control.captureBodies') }}</b>
              </div>
              <span>{{ t('control.captureBodiesDescription') }}</span>
            </div>
            <button
              type="button"
              class="booster-switch"
              :class="{ 'booster-switch-on': settings.observer.captureBodies }"
              :disabled="!settings.observer.enabled"
              @click="applyPatch({ observer: { captureBodies: !settings.observer.captureBodies } })"
            ><span /></button>
          </section>
        </template>

        <template v-else-if="activeSection === 'analytics'">
          <section class="booster-analytics-dashboard">
            <header class="booster-analytics-header">
              <div><strong>{{ t('control.analyticsOverview') }}</strong><span>{{ t('control.analyticsDescription') }}</span></div>
              <button v-if="diagnosticsAdapter" type="button" class="booster-action-secondary booster-analytics-reset" @click="resetCurrentAnalytics"><RefreshCcw class="size-3.5" />{{ t('control.resetCurrent') }}</button>
            </header>

            <div class="booster-analytics-metrics">
              <article><span>{{ t('control.requestTraffic') }}</span><strong>{{ currentRequestTotal }}</strong><small>{{ lifetimeRequestTotal }} · {{ t('control.allTime').toLocaleLowerCase() }}</small></article>
              <article><span>{{ t('control.messageTraffic') }}</span><strong>{{ currentMessageTotal }}</strong><small>{{ lifetimeMessageTotal }} · {{ t('control.allTime').toLocaleLowerCase() }}</small></article>
              <article :class="{ warning: counters.errors > 0 }"><span>{{ t('control.errors') }}</span><strong>{{ counters.errors }}</strong><small>{{ lifetimeCounters.errors }} · {{ t('control.allTime').toLocaleLowerCase() }}</small></article>
            </div>

            <div class="booster-analytics-flow-grid">
              <article class="booster-analytics-flow-card">
                <header><span><ArrowUpRight class="size-4" />{{ t('control.outbound') }}</span><b>{{ counters.requestsSent + counters.messagesSent }}</b></header>
                <div class="booster-analytics-flow-row"><span>{{ t('control.requestsSent') }}</span><div><i :style="{ width: bar(counters.requestsSent, counters.requestsSent + counters.messagesSent) }" /></div><b>{{ counters.requestsSent }}</b></div>
                <div class="booster-analytics-flow-row"><span>{{ t('control.messagesSent') }}</span><div><i :style="{ width: bar(counters.messagesSent, counters.requestsSent + counters.messagesSent) }" /></div><b>{{ counters.messagesSent }}</b></div>
              </article>
              <article class="booster-analytics-flow-card">
                <header><span><ArrowDownLeft class="size-4" />{{ t('control.inbound') }}</span><b>{{ counters.responsesReceived + counters.messagesReceived }}</b></header>
                <div class="booster-analytics-flow-row"><span>{{ t('control.responsesReceived') }}</span><div><i :style="{ width: bar(counters.responsesReceived, counters.responsesReceived + counters.messagesReceived) }" /></div><b>{{ counters.responsesReceived }}</b></div>
                <div class="booster-analytics-flow-row"><span>{{ t('control.messagesReceived') }}</span><div><i :style="{ width: bar(counters.messagesReceived, counters.responsesReceived + counters.messagesReceived) }" /></div><b>{{ counters.messagesReceived }}</b></div>
              </article>
            </div>

            <footer class="booster-analytics-footer">
              <span><Activity class="size-4" />{{ t('control.lastActivity') }} <b>{{ activityTime(counters.lastEventAt) }}</b></span>
              <span :class="{ warning: counters.errors > 0 }"><AlertTriangle class="size-4" />{{ t('control.errors') }} <b>{{ counters.errors }}</b></span>
            </footer>
          </section>
        </template>

        <template v-else>
          <section class="booster-setting-card">
            <div class="booster-setting-copy">
              <div class="flex items-center gap-2"><Languages class="size-4" /><b>{{ t('control.language') }}</b></div>
              <span>{{ t('control.languageDescription') }}</span>
            </div>
            <select
              class="booster-select"
              :value="settings.language"
              :aria-label="t('control.language')"
              @change="setLanguage"
            >
              <option value="auto">{{ t('common.auto') }}</option>
              <option value="en">{{ t('language.english') }}</option>
              <option value="ru">{{ t('language.russian') }}</option>
            </select>
          </section>

          <section class="booster-stack-card">
            <button class="booster-disclosure" type="button" @click="toggleTelemetryExpanded">
              <span>
                <b>{{ t('control.telemetry') }}</b>
                <small>{{ t('control.telemetryDescription') }}</small>
              </span>
              <ChevronDown
                class="size-4 transition-transform"
                :class="{ 'rotate-180': settings.ui.telemetryExpanded }"
              />
            </button>

            <div v-if="settings.ui.telemetryExpanded" class="booster-telemetry-body">
              <section class="booster-setting-card booster-setting-card-flat">
                <div class="booster-setting-copy"><b>{{ t('control.telemetry') }}</b></div>
                <button
                  type="button"
                  class="booster-switch"
                  :class="{ 'booster-switch-on': settings.telemetry.enabled }"
                  @click="applyPatch({ telemetry: { enabled: !settings.telemetry.enabled } })"
                ><span /></button>
              </section>

              <label class="booster-field">
                <span>{{ t('control.telemetryEndpoint') }}</span>
                <input
                  :value="settings.telemetry.endpoint"
                  class="booster-input"
                  :placeholder="t('control.telemetryEndpointPlaceholder')"
                  @change="setTelemetryEndpoint"
                />
              </label>

              <div v-if="secretAdapter" class="booster-field">
                <span class="flex items-center justify-between gap-2">
                  {{ t('control.telemetryToken') }}
                  <Badge :variant="tokenConfigured ? 'default' : 'secondary'">
                    {{ tokenConfigured ? t('control.tokenConfigured') : t('control.tokenMissing') }}
                  </Badge>
                </span>

                <div v-if="!tokenConfigured || tokenEditing" class="flex gap-2">
                  <input v-model="tokenDraft" class="booster-input" type="password" autocomplete="off" />
                  <Button variant="outline" size="sm" :disabled="!tokenDraft.trim()" @click="saveToken">
                    {{ t('control.saveToken') }}
                  </Button>
                  <Button v-if="tokenConfigured" variant="ghost" size="sm" @click="tokenEditing = false; tokenDraft = ''">
                    {{ t('control.cancel') }}
                  </Button>
                </div>
                <Button v-else variant="outline" size="sm" class="self-start" @click="tokenEditing = true">
                  {{ t('control.changeToken') }}
                </Button>
              </div>

              <div class="booster-telemetry-test-row">
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="telemetryTestState === 'testing' || !settings.telemetry.endpoint || !tokenConfigured"
                  @click="testTelemetry"
                >
                  {{ telemetryTestState === 'testing' ? t('control.testingTelemetry') : t('control.testTelemetry') }}
                </Button>
                <span v-if="telemetryTestState === 'success'" class="booster-test-success">{{ t('control.telemetryTestSuccess') }}</span>
                <span v-if="telemetryTestState === 'error'" class="booster-test-error" :title="telemetryTestError">{{ t('control.telemetryTestFailed') }}: {{ telemetryTestError }}</span>
              </div>
            </div>
          </section>
        </template>

        <footer class="booster-control-footer">
          <span class="booster-save-state">
            <Check v-if="saved" class="size-3.5" />
            {{ saving ? t('control.saving') : saved ? t('control.saved') : t('control.live') }}
          </span>
        </footer>
      </main>
    </div>

    <ModalSurface v-if="archiveResetOpen" :label="t('archiveReset.confirmTitle')" @close="!archiveResetting && (archiveResetOpen = false)">
      <div class="booster-destructive-dialog">
        <div class="booster-destructive-icon"><AlertTriangle class="size-6" /></div>
        <div>
          <strong>{{ t('archiveReset.confirmTitle') }}</strong>
          <p>{{ t('archiveReset.confirmDescription') }}</p>
          <p class="booster-destructive-warning">{{ t('archiveReset.irreversible') }}</p>
          <p v-if="archiveResetError" class="booster-test-error">{{ archiveResetError }}</p>
        </div>
        <div class="booster-destructive-actions">
          <Button variant="outline" :disabled="archiveResetting" @click="archiveResetOpen = false">{{ t('archiveReset.cancel') }}</Button>
          <button type="button" class="booster-destructive-button" :disabled="archiveResetting" @click="clearArchive">
            {{ archiveResetting ? t('archiveReset.clearing') : t('archiveReset.confirm') }}
          </button>
        </div>
      </div>
    </ModalSurface>
  </section>
</template>
