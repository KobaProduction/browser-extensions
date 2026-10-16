<script setup lang="ts">
import type { ChatGptAutomationControl } from '@chatgpt-booster/core'
import {
  type ArchiveCaptureContext,
  BOOSTER_VERSION,
  type DiagnosticsAdapter,
  EMPTY_TRANSPORT_COUNTERS,
  type PersistentDiagnosticsAdapter,
  type SecretAdapter,
  type SettingsAdapter,
  type SettingsSection,
  type TelemetryControlAdapter,
  type TransportCounters,
} from '@chatgpt-booster/core'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  Label,
  ModalSurface,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsCatalog,
  Slider,
  Switch,
  useApplicationLocale,
} from '@kobaproduction/browser-ui'
import Activity from 'lucide-vue-next/dist/esm/icons/activity.js'
import ArrowDownLeft from 'lucide-vue-next/dist/esm/icons/arrow-down-left.js'
import ArrowUpRight from 'lucide-vue-next/dist/esm/icons/arrow-up-right.js'
import BarChart3 from 'lucide-vue-next/dist/esm/icons/chart-column.js'
import Check from 'lucide-vue-next/dist/esm/icons/check.js'
import Clock3 from 'lucide-vue-next/dist/esm/icons/clock-3.js'
import RefreshCcw from 'lucide-vue-next/dist/esm/icons/refresh-ccw.js'
import ShieldCheck from 'lucide-vue-next/dist/esm/icons/shield-check.js'
import AlertTriangle from 'lucide-vue-next/dist/esm/icons/triangle-alert.js'
import Wrench from 'lucide-vue-next/dist/esm/icons/wrench.js'
import X from 'lucide-vue-next/dist/esm/icons/x.js'
import { computed, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import AutomationSettings from './AutomationSettings.vue'
import CaptureSettings from './CaptureSettings.vue'
import { translate } from './i18n'
import type { ArchiveDataAdapter } from './mount'
import SoundSettings from './SoundSettings.vue'
import { usePersistedSettings } from './use-persisted-settings'

const props = withDefaults(
  defineProps<{
    settingsAdapter: SettingsAdapter
    archiveAdapter?: ArchiveDataAdapter | undefined
    captureContext?: ArchiveCaptureContext | undefined
    diagnosticsAdapter?: DiagnosticsAdapter | undefined
    persistentDiagnosticsAdapter?: PersistentDiagnosticsAdapter | undefined
    secretAdapter?: SecretAdapter | undefined
    automationControl?: ChatGptAutomationControl | undefined
    telemetryControlAdapter?: TelemetryControlAdapter | undefined
    targetLabel: string
    showClose?: boolean
    embedded?: boolean
    showCatalog?: boolean
  }>(),
  { showClose: false, showCatalog: true },
)

const emit = defineEmits<{ close: [] }>()
const fieldId = useId()
const { settings, loading, loadFailed, saving, saved, saveFailed, load, applyPatch, retrySave } =
  usePersistedSettings(props.settingsAdapter)
const diagnosticsFailed = ref(false)
const archiveResetOpen = ref(false)
const archiveResetting = ref(false)
const archiveResetError = ref('')
const counters = ref<TransportCounters>({ ...EMPTY_TRANSPORT_COUNTERS })
const lifetimeCounters = ref<TransportCounters>({ ...EMPTY_TRANSPORT_COUNTERS })
let unsubscribeDiagnostics: (() => void) | undefined
let unsubscribeLifetimeDiagnostics: (() => void) | undefined

const locale = useApplicationLocale(() => settings.value?.language ?? 'auto')
const t = (key: Parameters<typeof translate>[1]) => translate(locale.value, key)
const activeSection = computed(() =>
  settings.value?.ui.activeSection === 'other'
    ? 'modules'
    : (settings.value?.ui.activeSection ?? 'modules'),
)
const settingsCatalog = computed(() => [
  {
    id: 'chatgpt',
    title: 'ChatGPT Booster',
    entries: [
      { id: 'archive', title: t('capture.title') },
      { id: 'modules', title: t('control.modules') },
      { id: 'sounds', title: locale.value === 'ru' ? 'Звуки' : 'Sounds' },
      { id: 'triggers', title: locale.value === 'ru' ? 'Триггеры' : 'Triggers' },
      { id: 'remote', title: locale.value === 'ru' ? 'Сервер и синхронизация' : 'Server and sync' },
      { id: 'analytics', title: t('control.analytics') },
    ],
  },
])
function selectCategory(id: string) {
  if (['archive', 'modules', 'sounds', 'analytics', 'other', 'triggers', 'remote'].includes(id))
    void setSection((id === 'other' ? 'modules' : id) as SettingsSection)
}

const currentRequestTotal = computed(
  () => counters.value.requestsSent + counters.value.responsesReceived,
)
const lifetimeRequestTotal = computed(
  () => lifetimeCounters.value.requestsSent + lifetimeCounters.value.responsesReceived,
)
const currentMessageTotal = computed(() => counters.value.messagesSent + counters.value.messagesReceived)
const lifetimeMessageTotal = computed(
  () => lifetimeCounters.value.messagesSent + lifetimeCounters.value.messagesReceived,
)
function bar(value: number, total: number) {
  return `${total > 0 ? Math.max(3, Math.round((value / total) * 100)) : 0}%`
}
function activityTime(value: number | null) {
  return value
    ? new Date(value).toLocaleTimeString(locale.value, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : t('control.noActivity')
}
function resetCurrentAnalytics() {
  props.diagnosticsAdapter?.resetTransport()
}

onMounted(async () => {
  void load()
  try {
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
  } catch {
    diagnosticsFailed.value = true
  }
})

onBeforeUnmount(() => {
  unsubscribeDiagnostics?.()
  unsubscribeLifetimeDiagnostics?.()
})

async function setSection(section: SettingsSection) {
  await applyPatch({ ui: { activeSection: section } })
}

async function setMonitoringInterval(value: number[]) {
  await applyPatch({
    monitoring: { intervalMs: Number(value[0]) },
  })
}

function monitoringIntervalLabel(value: number) {
  return value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(value % 1000 ? 1 : 0)} s`
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
</script>

<template>
  <section class="booster-control-center" :class="{ 'booster-control-embedded': embedded }" :lang="locale">
    <header v-if="!embedded" class="booster-control-header">
      <div class="booster-header-copy">
        <div class="flex items-center gap-2">
          <strong>{{ t('control.title') }}</strong>
          <Badge variant="outline" :title="BOOSTER_VERSION">{{ BOOSTER_VERSION }}</Badge>
        </div>
        <p>{{ t('control.subtitle') }}</p>
      </div>

      <div v-if="settings" class="booster-header-actions">
        <span class="booster-header-toggle-label">{{ t('control.booster') }}</span>
        <Switch :model-value="settings.enabled"
          :aria-label="t('control.booster')"
          @update:model-value="applyPatch({ enabled: $event })"
         />
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

    <Alert v-if="loadFailed" variant="destructive"><AlertDescription>{{ locale === 'ru' ? 'Не удалось загрузить настройки.' : 'Could not load settings.' }} <Button variant="outline" size="sm" :disabled="loading" @click="load">{{ locale === 'ru' ? 'Повторить' : 'Retry' }}</Button></AlertDescription></Alert>
    <div v-else-if="loading || !settings" class="booster-loading" role="status">{{ t('control.loading') }}</div>

    <div v-else class="booster-settings-layout">
      <SettingsCatalog v-if="showCatalog" class="booster-settings-nav" :groups="settingsCatalog" :selected="activeSection"
        :label="locale === 'ru' ? 'Категории настроек ChatGPT' : 'ChatGPT settings categories'" @select="selectCategory" />

      <main class="booster-settings-content" :data-settings-section="activeSection">
        <Alert v-if="saveFailed" variant="destructive"><AlertDescription>{{ locale === 'ru' ? 'Не удалось сохранить настройки. Восстановлены последние сохранённые значения.' : 'Could not save settings. The last saved values have been restored.' }} <Button variant="outline" size="sm" :disabled="saving" @click="retrySave">{{ locale === 'ru' ? 'Повторить сохранение' : 'Retry saving' }}</Button></AlertDescription></Alert>
        <Alert v-if="diagnosticsFailed"><AlertDescription>{{ locale === 'ru' ? 'Счётчики диагностики недоступны. Настройки доступны.' : 'Diagnostic counters are unavailable. Settings are available.' }}</AlertDescription></Alert>
        <template v-if="activeSection === 'archive'">
          <Card class="booster-setting-card">
            <div class="booster-setting-copy">
              <b>{{ locale === 'ru' ? 'Открывать архив' : 'Open archive at' }}</b>
              <span>{{ locale === 'ru' ? 'С начала или с конца сохранённых сообщений' : 'Choose the saved history endpoint' }}</span>
            </div>
            <Select :model-value="settings.ui.archiveStart"
              @update:model-value="applyPatch({ ui: { archiveStart: String($event) === 'first' ? 'first' : 'latest' } })"><SelectTrigger class="w-full"><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="latest">{{ locale === 'ru' ? 'Конец истории' : 'Latest messages' }}</SelectItem>
              <SelectItem value="first">{{ locale === 'ru' ? 'Начало сохранённой истории' : 'First saved messages' }}</SelectItem>
            </SelectContent></Select>
          </Card>
          <CaptureSettings :settings-adapter="settingsAdapter" :archive-adapter="archiveAdapter" :context="captureContext" :locale="locale" />
          <section v-if="archiveAdapter" class="booster-danger-zone">
            <div class="booster-setting-copy">
              <div class="flex items-center gap-2"><AlertTriangle class="size-4" /><b>{{ t('archiveReset.title') }}</b></div>
              <span>{{ t('archiveReset.description') }}</span>
            </div>
            <Button variant="destructive" type="button" @click="archiveResetError = ''; archiveResetOpen = true">
              {{ t('archiveReset.action') }}
            </Button>
          </section>
        </template>
        <template v-else-if="activeSection === 'modules'">
          <Card class="booster-setting-card">
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
            <Switch :model-value="settings.features.messageMetadata"
              :disabled="!settings.enabled"
              :aria-label="t('control.messageMetadata')"
              @update:model-value="applyPatch({ features: { messageMetadata: $event } })"
             />
          </Card>

          <Card class="booster-setting-card" :class="{ 'booster-setting-disabled': !settings.enabled }">
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
            <Switch :model-value="settings.features.activityIndicator"
              :aria-label="t('control.activityIndicator')"
              :disabled="!settings.enabled"
              @update:model-value="applyPatch({ features: { activityIndicator: $event } })"
             />
          </Card>

          <Card class="booster-setting-card booster-setting-card-stack" :class="{ 'booster-setting-disabled': !settings.enabled }">
            <div class="booster-setting-copy">
              <div class="flex items-center gap-2">
                <Clock3 class="size-4" />
                <b>{{ t('control.requestTimer') }}</b>
                <Badge :variant="settings.features.requestTimer && settings.enabled ? 'default' : 'secondary'">
                  {{ settings.features.requestTimer && settings.enabled ? t('common.on') : t('common.off') }}
                </Badge>
              </div>
              <span>{{ t('control.requestTimerDescription') }}</span>
            </div>
            <div class="booster-alert-setting-actions">
              <Switch :model-value="settings.features.requestTimer"
                :aria-label="t('control.requestTimer')"
                :disabled="!settings.enabled"
                @update:model-value="applyPatch({ features: { requestTimer: $event } })"
               />
              <Label :id="`${fieldId}-timer-interval`" class="booster-alert-threshold">
                <span>{{ t('control.monitoringInterval') }} <b>{{ Math.round(settings.monitoring.intervalMs) }} ms</b></span>
                <Slider
                  :aria-labelledby="`${fieldId}-timer-interval`"
                  :min="100"
                  :max="2000"
                  :step="100"
                  :model-value="[settings.monitoring.intervalMs]"
                  :disabled="!settings.enabled"
                  @value-commit="setMonitoringInterval"
                 />
              </Label>
            </div>
          </Card>

          <Card class="booster-setting-card" :class="{ 'booster-setting-disabled': !settings.enabled }">
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
            <Switch :model-value="settings.features.toolInspector"
              :aria-label="t('control.toolInspector')"
              :disabled="!settings.enabled"
              @update:model-value="applyPatch({ features: { toolInspector: $event } })"
             />
          </Card>

          <Card class="booster-setting-card booster-setting-card-stack" :class="{ 'booster-setting-disabled': !settings.enabled }">
            <div class="booster-setting-copy">
              <div class="flex items-center gap-2">
                <RefreshCcw class="size-4" />
                <b>{{ t('control.monitoringInterval') }}</b>
              </div>
              <span>{{ t('control.monitoringIntervalDescription') }}</span>
            </div>
            <div class="booster-range-grid">
              <Label :id="`${fieldId}-monitoring`">
                <span>{{ t('control.monitoringInterval') }} <b>{{ monitoringIntervalLabel(settings.monitoring.intervalMs) }}</b></span>
                <Slider
                  :aria-labelledby="`${fieldId}-monitoring`"
                  :min="100"
                  :max="10000"
                  :step="100"
                  :model-value="[settings.monitoring.intervalMs]"
                  :disabled="!settings.enabled"
                  @value-commit="setMonitoringInterval"
                 />
              </Label>
            </div>
          </Card>



          <Card class="booster-setting-card" :class="{ 'booster-setting-disabled': !settings.enabled }">
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
            <Switch :model-value="settings.observer.enabled"
              :aria-label="t('control.observer')"
              :disabled="!settings.enabled"
              @update:model-value="applyPatch({ observer: { enabled: $event } })"
             />
          </Card>

          <Card class="booster-setting-card" :class="{ 'booster-setting-disabled': !settings.observer.enabled }">
            <div class="booster-setting-copy">
              <div class="flex items-center gap-2">
                <ShieldCheck class="size-4" />
                <b>{{ t('control.captureBodies') }}</b>
              </div>
              <span>{{ t('control.captureBodiesDescription') }}</span>
            </div>
            <Switch :model-value="settings.observer.captureBodies"
              :aria-label="t('control.captureBodies')"
              :disabled="!settings.observer.enabled"
              @update:model-value="applyPatch({ observer: { captureBodies: $event } })"
             />
          </Card>
        </template>

        <template v-else-if="activeSection === 'sounds'">
          <SoundSettings :settings="settings" :locale="locale" @patch="applyPatch" />
        </template>
        <template v-else-if="activeSection === 'triggers' || activeSection === 'remote'">
          <AutomationSettings :settings="settings" :section="activeSection" :secrets="secretAdapter" :control="automationControl" :save-settings="applyPatch" />
        </template>
        <template v-else-if="activeSection === 'analytics'">
          <section class="booster-analytics-dashboard">
            <header class="booster-analytics-header">
              <div><strong>{{ t('control.analyticsOverview') }}</strong><span>{{ t('control.analyticsDescription') }}</span></div>
              <Button variant="outline" v-if="diagnosticsAdapter" type="button" class="booster-action-secondary booster-analytics-reset" @click="resetCurrentAnalytics"><RefreshCcw class="size-3.5" />{{ t('control.resetCurrent') }}</Button>
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
          <p class="booster-note">{{ locale === 'ru' ? 'Телеметрия и резервные копии настраиваются в общих настройках приложения.' : 'Telemetry and backups are configured in application settings.' }}</p>
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
          <Button variant="destructive" type="button" class="booster-destructive-button" :disabled="archiveResetting" @click="clearArchive">
            {{ archiveResetting ? t('archiveReset.clearing') : t('archiveReset.confirm') }}
          </Button>
        </div>
      </div>
    </ModalSurface>
  </section>
</template>
