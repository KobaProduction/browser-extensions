<script setup lang="ts">
import type { BoosterSettings, BoosterSettingsPatch } from '@chatgpt-booster/core'
import {
  Alert,
  AlertDescription,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingRow,
} from '@kobaproduction/browser-ui'
import { ref, useId, watch } from 'vue'

const props = defineProps<{ settings: BoosterSettings; locale: 'ru' | 'en' }>()
const emit = defineEmits<{ patch: [patch: BoosterSettingsPatch] }>()
const id = useId(),
  error = ref('')
const threshold = ref<string | number>(props.settings.alerts.longRunningThresholdMs / 1000)
watch(
  () => props.settings.alerts.longRunningThresholdMs,
  (value) => {
    threshold.value = value / 1000
  },
)
const channels = [
  { enabled: 'userSendSound', tone: 'sendTone', ru: 'Отправка сообщения', en: 'Message sent' },
  {
    enabled: 'responseCompleteSound',
    tone: 'completeTone',
    ru: 'Ответ завершён',
    en: 'Assistant response completed',
  },
  {
    enabled: 'conversationEndSound',
    tone: 'endTone',
    ru: 'Контекст исчерпан',
    en: 'Conversation context exhausted',
  },
] as const
function setTone(key: 'sendTone' | 'completeTone' | 'endTone', input: unknown) {
  const value = String(input)
  if (value === 'soft' || value === 'chime' || value === 'pulse')
    emit('patch', { alerts: { [key]: value } })
}
function saveThreshold(event?: Event) {
  const draft = (event?.target as HTMLInputElement | null)?.value ?? threshold.value
  const value = Number(draft)
  if (String(draft).trim() === '' || !Number.isSafeInteger(value) || value < 15 || value > 1800) {
    error.value =
      props.locale === 'ru'
        ? 'Укажите целое число от 15 до 1800 секунд.'
        : 'Enter a whole number from 15 to 1800 seconds.'
    return
  }
  error.value = ''
  if (value * 1000 !== props.settings.alerts.longRunningThresholdMs)
    emit('patch', { alerts: { longRunningThresholdMs: value * 1000 } })
}
</script>

<template>
  <section class="min-w-0 space-y-3" :aria-label="locale === 'ru' ? 'Звуковые уведомления' : 'Sound notifications'">
    <SettingRow :id="`${id}-enabled`" :title="locale === 'ru' ? 'Звуковые уведомления' : 'Sound notifications'" :description="locale === 'ru' ? 'Звуки событий ChatGPT и действий триггеров. Выключение сразу останавливает все сигналы. Исчерпание контекста подтверждается событием сервера.' : 'Sounds for ChatGPT events and trigger actions. Turning this off stops all sounds immediately. Context exhaustion requires a server event.'" :model-value="settings.alerts.enabled" @update:model-value="emit('patch', { alerts: { enabled: $event } })" />
    <div class="grid min-w-0 gap-3 min-[1024px]:grid-cols-2">
      <SettingRow v-for="channel in channels" :key="channel.enabled" :id="`${id}-${channel.enabled}`" :title="locale === 'ru' ? channel.ru : channel.en" :model-value="settings.alerts[channel.enabled]" :disabled="!settings.alerts.enabled" @update:model-value="emit('patch', { alerts: { [channel.enabled]: $event } })">
        <div class="grid min-w-0 gap-2 pt-2"><Label :for="`${id}-${channel.tone}`" class="text-xs text-muted-foreground">{{ locale === 'ru' ? 'Мелодия' : 'Tone' }}</Label><Select :model-value="settings.alerts[channel.tone]" :disabled="!settings.alerts.enabled || !settings.alerts[channel.enabled]" @update:model-value="setTone(channel.tone, $event)"><SelectTrigger :id="`${id}-${channel.tone}`" class="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="soft">{{ locale === 'ru' ? 'Мягкий' : 'Soft' }}</SelectItem><SelectItem value="chime">{{ locale === 'ru' ? 'Колокольчик' : 'Chime' }}</SelectItem><SelectItem value="pulse">{{ locale === 'ru' ? 'Завершающий' : 'Ending' }}</SelectItem></SelectContent></Select></div>
      </SettingRow>
      <SettingRow :id="`${id}-long-running`" :title="locale === 'ru' ? 'Сигнал долгого запроса' : 'Long request notification'" :model-value="settings.alerts.longRunningSound" :disabled="!settings.alerts.enabled" @update:model-value="emit('patch', { alerts: { longRunningSound: $event } })">
        <div class="grid min-w-0 gap-2 pt-2"><Label :for="`${id}-threshold`" class="text-xs text-muted-foreground">{{ locale === 'ru' ? 'Порог, секунд' : 'Threshold, seconds' }}</Label><Input :id="`${id}-threshold`" v-model="threshold" type="number" min="15" max="1800" step="1" :disabled="!settings.alerts.enabled || !settings.alerts.longRunningSound" :aria-invalid="Boolean(error)" :aria-describedby="error ? `${id}-threshold-error` : undefined" @change="saveThreshold" /></div>
      </SettingRow>
    </div>
    <Alert v-if="error" variant="destructive"><AlertDescription :id="`${id}-threshold-error`">{{ error }}</AlertDescription></Alert>
  </section>
</template>
