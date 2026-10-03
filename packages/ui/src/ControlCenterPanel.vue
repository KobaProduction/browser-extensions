<script setup lang="ts">
import {
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
import {
  Activity,
  BarChart3,
  Check,
  ChevronDown,
  Languages,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Wrench,
  X,
} from 'lucide-vue-next'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { resolveLocale, translate } from './i18n'
import CaptureSettings from './CaptureSettings.vue'
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
    target: 'extension' | 'userscript'
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
const targetLabel = computed(() => (props.target === 'userscript' ? 'Tampermonkey' : 'Extension'))
const activeSection = computed(() => settings.value?.ui.activeSection ?? 'modules')

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
        <CaptureSettings v-if="activeSection === 'archive'" :settings-adapter="settingsAdapter" :archive-adapter="archiveAdapter" :context="captureContext" :locale="locale" />
        <template v-if="activeSection === 'modules'">
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
          <section class="booster-analytics-grid">
            <div v-if="diagnosticsAdapter" class="booster-counter-card">
              <div class="booster-counter-title">{{ t('control.currentTab') }}</div>
              <div class="booster-counter-grid">
                <span>{{ t('control.requestsSent') }} <b>{{ counters.requestsSent }}</b></span>
                <span>{{ t('control.responsesReceived') }} <b>{{ counters.responsesReceived }}</b></span>
                <span>{{ t('control.messagesSent') }} <b>{{ counters.messagesSent }}</b></span>
                <span>{{ t('control.messagesReceived') }} <b>{{ counters.messagesReceived }}</b></span>
                <span>{{ t('control.errors') }} <b>{{ counters.errors }}</b></span>
              </div>
            </div>

            <div class="booster-counter-card">
              <div class="booster-counter-title">{{ t('control.allTime') }}</div>
              <div class="booster-counter-grid">
                <span>{{ t('control.requestsSent') }} <b>{{ lifetimeCounters.requestsSent }}</b></span>
                <span>{{ t('control.responsesReceived') }} <b>{{ lifetimeCounters.responsesReceived }}</b></span>
                <span>{{ t('control.messagesSent') }} <b>{{ lifetimeCounters.messagesSent }}</b></span>
                <span>{{ t('control.messagesReceived') }} <b>{{ lifetimeCounters.messagesReceived }}</b></span>
                <span>{{ t('control.errors') }} <b>{{ lifetimeCounters.errors }}</b></span>
              </div>
            </div>
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
  </section>
</template>
