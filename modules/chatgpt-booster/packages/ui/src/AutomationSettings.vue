<script setup lang="ts">
import type {
  BoosterSettings,
  BoosterSettingsPatch,
  ChatGptAutomationControl,
  ChatGptAutomationStatus,
  SecretAdapter,
} from '@chatgpt-booster/core'
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  useLocalizedText,
} from '@kobaproduction/browser-ui'
import { computed, onBeforeUnmount, reactive, shallowRef, watch } from 'vue'
import AutomationRulesSettings from './AutomationRulesSettings.vue'
import { AUTOMATION_UI_MESSAGES } from './i18n/automation'
import RemoteArchiveSyncSettings from './RemoteArchiveSyncSettings.vue'
import RemoteCommandPermissions from './RemoteCommandPermissions.vue'
import RemoteConnectionSettings from './RemoteConnectionSettings.vue'
import RemoteDeliverySettings from './RemoteDeliverySettings.vue'

const text = useLocalizedText(AUTOMATION_UI_MESSAGES)
const commandErrors: Readonly<Record<string, string>> = {
  'automation.nativeMethodUnavailable': 'Команда недоступна: подтверждённый метод ChatGPT не подключён.',
  'automation.commandUnconfirmed': 'ChatGPT не подтвердил выполнение команды.',
  'automation.ownerChanged': 'Аккаунт изменился. Команда отменена.',
  'automation.commandCancelled': 'Команда отменена.',
  'automation.conversationChanged': 'Диалог или проект изменился. Команда отменена.',
  'automation.stopUnavailable': 'Нет подтверждённого активного запроса для остановки.',
}
function automationError(code: string) {
  return text(
    commandErrors[code] ??
      'Действие не выполнено. Проверьте подключение, доступ и доступность метода приложения.',
  )
}

const props = defineProps<{
  settings: BoosterSettings
  section: 'triggers' | 'remote'
  secrets?: SecretAdapter
  control?: ChatGptAutomationControl
  saveSettings: (patch: BoosterSettingsPatch) => Promise<boolean>
}>()
const saveRemote = (patch: Partial<BoosterSettings['automation']['remote']>) =>
  props.saveSettings({ automation: { remote: patch } })
const status = shallowRef<ChatGptAutomationStatus>()
const statusError = shallowRef(false)
const operations = reactive({ connection: false, delivery: false, sync: false })
const remoteBusy = computed(
  () =>
    Object.values(operations).some(Boolean) ||
    status.value?.sync.state === 'preparing' ||
    status.value?.sync.state === 'queuing',
)
let unsubscribe: (() => void) | undefined
let generation = 0
function refresh() {
  try {
    status.value = props.control?.status()
    statusError.value = false
  } catch {
    status.value = undefined
    statusError.value = true
  }
}
watch(
  () => props.control,
  (control) => {
    const current = ++generation
    unsubscribe?.()
    unsubscribe = undefined
    refresh()
    if (control)
      unsubscribe = control.subscribe(() => {
        if (current === generation) refresh()
      })
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  generation++
  unsubscribe?.()
})
</script>

<template>
  <section class="min-w-0 space-y-3" :aria-label="section === 'triggers' ? text('Триггеры') : text('Сервер и синхронизация')">
    <Alert v-if="statusError" variant="destructive"><AlertDescription>{{ text('Статус автоматизации недоступен. Повторно откройте раздел.') }}</AlertDescription></Alert>
    <Alert v-if="status?.lastError" variant="destructive"><AlertDescription role="alert">{{ automationError(status.lastError) }}</AlertDescription></Alert>
    <AutomationRulesSettings v-if="section === 'triggers'" :settings="settings" :status="status" :control="control" :save-settings="saveSettings" @refresh="refresh" />
    <template v-else>
      <RemoteConnectionSettings :configuration="settings.automation.remote" :secrets="secrets" :control="control" :disabled="remoteBusy" :save-configuration="saveRemote" @busy="operations.connection = $event" />
      <div class="grid min-w-0 items-start gap-3" :class="control ? 'min-[1024px]:grid-cols-2' : undefined">
        <RemoteDeliverySettings :configuration="settings.automation.remote" :status="status" :control="control" :disabled="remoteBusy" @busy="operations.delivery = $event" @refresh="refresh" @patch="saveRemote" />
        <RemoteArchiveSyncSettings v-if="control" :configuration="settings.automation.remote" :status="status" :control="control" :disabled="remoteBusy" @busy="operations.sync = $event" @refresh="refresh" />
      </div>
      <Card><CardHeader class="p-4 pb-3"><CardTitle class="text-base">{{ text('Удалённые команды') }}</CardTitle><CardDescription>{{ text('Разрешите нужные действия по группам. По умолчанию сервер не может управлять чатом.') }}</CardDescription></CardHeader><CardContent class="p-4 pt-0"><RemoteCommandPermissions :allowed="settings.automation.remote.allowedCommands" :disabled="remoteBusy" @change="saveRemote({ allowedCommands: $event })" /></CardContent></Card>
    </template>
  </section>
</template>
