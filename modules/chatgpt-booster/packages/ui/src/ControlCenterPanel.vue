<script setup lang="ts">
import type { ChatGptAutomationControl } from '@chatgpt-booster/core'
import {
  type ArchiveCaptureContext,
  BOOSTER_VERSION,
  CHATGPT_SETTINGS_CATEGORIES,
  chatGptSettingsCategory,
  type DiagnosticsAdapter,
  type PersistentDiagnosticsAdapter,
  type SecretAdapter,
  type SettingsAdapter,
  type SettingsSection,
  type TelemetryControlAdapter,
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
  SettingField,
  SettingRow,
  SettingsCatalog,
  SettingsGrid,
  SettingsPane,
  Slider,
  Switch,
  useApplicationLocale,
} from '@kobaproduction/browser-ui'
import Check from 'lucide-vue-next/dist/esm/icons/check.js'
import AlertTriangle from 'lucide-vue-next/dist/esm/icons/triangle-alert.js'
import X from 'lucide-vue-next/dist/esm/icons/x.js'
import { computed, onMounted, ref, useId } from 'vue'
import AutomationSettings from './AutomationSettings.vue'
import CaptureSettings from './CaptureSettings.vue'
import { translate } from './i18n'
import type { ArchiveDataAdapter } from './mount'
import SoundSettings from './SoundSettings.vue'
import TransportAnalytics from './TransportAnalytics.vue'
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
const displayFeatures = [
  'messageMetadata',
  'activityIndicator',
  'requestTimer',
  'toolInspector',
] as const
const { settings, loading, loadFailed, saving, saved, saveFailed, load, applyPatch, retrySave } =
  usePersistedSettings(props.settingsAdapter)
const archiveResetOpen = ref(false)
const archiveResetting = ref(false)
const archiveResetError = ref('')

const locale = useApplicationLocale(() => settings.value?.language ?? 'auto')
const t = (key: Parameters<typeof translate>[1]) => translate(locale.value, key)
const activeSection = computed(
  () => chatGptSettingsCategory(settings.value?.ui.activeSection ?? '') ?? 'modules',
)
const settingsCatalog = computed(() => [
  {
    id: 'chatgpt',
    title: 'ChatGPT Booster',
    entries: CHATGPT_SETTINGS_CATEGORIES.map(({ id, title, titleEn, description, descriptionEn }) => ({
      id,
      title: locale.value === 'en' ? titleEn : title,
      description: locale.value === 'en' ? descriptionEn : description,
    })),
  },
])
function selectCategory(id: string) {
  const category = chatGptSettingsCategory(id)
  if (category) void setSection(category)
}

onMounted(load)

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

      <SettingsPane :embedded="embedded" :data-settings-section="activeSection">
        <Alert v-if="saveFailed" variant="destructive"><AlertDescription>{{ locale === 'ru' ? 'Не удалось сохранить настройки. Восстановлены последние сохранённые значения.' : 'Could not save settings. The last saved values have been restored.' }} <Button variant="outline" size="sm" :disabled="saving" @click="retrySave">{{ locale === 'ru' ? 'Повторить сохранение' : 'Retry saving' }}</Button></AlertDescription></Alert>
        <template v-if="activeSection === 'archive'">
          <SettingField :id="`${fieldId}-archive-start`"
            :title="locale === 'ru' ? 'Открывать архив' : 'Open archive at'"
            :description="locale === 'ru' ? 'С начала или с конца сохранённых сообщений' : 'Choose the saved history endpoint'"
            v-slot="{ descriptionId }">
            <Select :model-value="settings.ui.archiveStart"
              @update:model-value="applyPatch({ ui: { archiveStart: String($event) === 'first' ? 'first' : 'latest' } })"><SelectTrigger :id="`${fieldId}-archive-start`" :aria-describedby="descriptionId" class="w-full"><SelectValue /></SelectTrigger><SelectContent>
              <SelectItem value="latest">{{ locale === 'ru' ? 'Конец истории' : 'Latest messages' }}</SelectItem>
              <SelectItem value="first">{{ locale === 'ru' ? 'Начало сохранённой истории' : 'First saved messages' }}</SelectItem>
            </SelectContent></Select>
          </SettingField>
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
          <SettingsGrid>
            <SettingRow v-for="feature in displayFeatures" :key="feature"
              :id="`${fieldId}-${feature}`"
              :title="t(`control.${feature}`)"
              :description="t(`control.${feature}Description`)"
              :model-value="settings.features[feature]" :disabled="!settings.enabled"
              @update:model-value="applyPatch({ features: { [feature]: $event } })" />
            <Card class="grid min-w-0 gap-2 p-3">
              <Label :id="`${fieldId}-monitoring`" class="flex flex-wrap justify-between gap-1 text-sm leading-5">
                <span>{{ t('control.monitoringInterval') }}</span>
                <span>{{ monitoringIntervalLabel(settings.monitoring.intervalMs) }}</span>
              </Label>
              <p :id="`${fieldId}-monitoring-description`" class="text-xs leading-5 text-muted-foreground">{{ t('control.monitoringIntervalDescription') }}</p>
              <Slider
                :aria-labelledby="`${fieldId}-monitoring`"
                :aria-describedby="`${fieldId}-monitoring-description`"
                :min="100" :max="10000" :step="100"
                :model-value="[settings.monitoring.intervalMs]" :disabled="!settings.enabled"
                @value-commit="setMonitoringInterval" />
            </Card>
            <SettingRow :id="`${fieldId}-observer`" :title="t('control.observer')"
              :description="t('control.observerDescription')"
              :model-value="settings.observer.enabled" :disabled="!settings.enabled"
              @update:model-value="applyPatch({ observer: { enabled: $event } })" />
            <SettingRow :id="`${fieldId}-capture-bodies`" :title="t('control.captureBodies')"
              :description="t('control.captureBodiesDescription')"
              :model-value="settings.observer.captureBodies" :disabled="!settings.observer.enabled"
              @update:model-value="applyPatch({ observer: { captureBodies: $event } })" />
          </SettingsGrid>
        </template>

        <template v-else-if="activeSection === 'sounds'">
          <SoundSettings :settings="settings" :locale="locale" @patch="applyPatch" />
        </template>
        <template v-else-if="activeSection === 'triggers' || activeSection === 'remote'">
          <AutomationSettings :settings="settings" :section="activeSection" :secrets="secretAdapter" :control="automationControl" :save-settings="applyPatch" />
        </template>
        <TransportAnalytics v-else-if="activeSection === 'analytics'" :locale="locale"
          :diagnostics="diagnosticsAdapter" :persistent-diagnostics="persistentDiagnosticsAdapter" />

        <template v-else>
          <p class="booster-note">{{ locale === 'ru' ? 'Телеметрия и резервные копии настраиваются в общих настройках приложения.' : 'Telemetry and backups are configured in application settings.' }}</p>
        </template>

        <footer class="booster-control-footer">
          <span class="booster-save-state">
            <Check v-if="saved" class="size-3.5" />
            {{ saving ? t('control.saving') : saved ? t('control.saved') : t('control.live') }}
          </span>
        </footer>
      </SettingsPane>
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
