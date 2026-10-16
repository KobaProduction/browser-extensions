<script setup lang="ts">
import type { AutomationAction } from '@kobaproduction/browser-core'
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useLocalizedText,
} from '@kobaproduction/browser-ui'
import { useId } from 'vue'
import { AUTOMATION_UI_MESSAGES } from './i18n/automation'

const text = useLocalizedText(AUTOMATION_UI_MESSAGES)

const props = defineProps<{
  action: AutomationAction
  index: number
  canRemove: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ update: [action: AutomationAction]; remove: [] }>()
const id = useId()
const kinds = [
  { id: 'send-message', title: 'Отправить сообщение' },
  { id: 'stop', title: 'Остановить ответ' },
  { id: 'continue', title: 'Продолжить' },
  { id: 'new-chat', title: 'Новый чат' },
  { id: 'play-sound', title: 'Воспроизвести звук' },
  { id: 'remote-event', title: 'Событие на сервер' },
] as const
function setKind(value: unknown) {
  const type = String(value)
  if (type === 'send-message') emit('update', { type, text: '' })
  else if (type === 'remote-event') emit('update', { type, name: '' })
  else if (type === 'play-sound') emit('update', { type, tone: 'chime' })
  else if (type === 'stop' || type === 'continue' || type === 'new-chat') emit('update', { type })
}
function actionText() {
  return 'text' in props.action
    ? (props.action.text ?? '')
    : 'name' in props.action
      ? props.action.name
      : ''
}
function setText(value: unknown) {
  const text = String(value),
    action = props.action
  if (action.type === 'send-message') emit('update', { ...action, text })
  else if (action.type === 'remote-event') emit('update', { ...action, name: text })
  else if (action.type === 'continue' || action.type === 'new-chat') {
    const { text: _previous, ...rest } = action
    emit('update', { ...rest, ...(text.trim() ? { text } : {}) })
  }
}
function setProject(value: unknown) {
  if (props.action.type !== 'new-chat') return
  const { projectId: _previous, ...rest } = props.action
  const projectId = String(value).trim()
  emit('update', { ...rest, ...(projectId ? { projectId } : {}) })
}
function setTone(value: unknown) {
  if (props.action.type === 'play-sound' && (value === 'soft' || value === 'chime' || value === 'pulse'))
    emit('update', { ...props.action, tone: value })
}
</script>

<template>
  <fieldset :disabled="disabled" class="min-w-0 space-y-3 border-t pt-3">
    <div class="flex min-w-0 items-center justify-between gap-3">
      <Label :for="`${id}-kind`">{{ text('Действие ') }}{{ index + 1 }}</Label>
      <Button v-if="canRemove" type="button" variant="ghost" size="sm" :disabled="disabled" :aria-label="`${text('Удалить действие ')}${index + 1}`" @click="emit('remove')">{{ text('Удалить') }}</Button>
    </div>
    <Select :model-value="action.type" :disabled="disabled" @update:model-value="setKind"><SelectTrigger :id="`${id}-kind`" class="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="kind in kinds" :key="kind.id" :value="kind.id">{{ text(kind.title) }}</SelectItem></SelectContent></Select>
    <div v-if="action.type === 'play-sound'" class="grid min-w-0 gap-2">
      <Label :for="`${id}-tone`">{{ text('Мелодия') }}</Label>
      <Select :model-value="action.tone" :disabled="disabled" @update:model-value="setTone"><SelectTrigger :id="`${id}-tone`" class="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="soft">{{ text('Мягкий') }}</SelectItem><SelectItem value="chime">{{ text('Колокольчик') }}</SelectItem><SelectItem value="pulse">{{ text('Завершающий') }}</SelectItem></SelectContent></Select>
      <p class="text-xs text-muted-foreground">{{ text('Воспроизводится, когда звуковые уведомления включены.') }}</p>
    </div>
    <div v-else-if="action.type !== 'stop'" class="grid min-w-0 gap-2">
      <Label :for="`${id}-text`">{{ action.type === 'remote-event' ? text('Имя события на сервере') : action.type === 'send-message' ? text('Текст сообщения') : text('Текст сообщения, необязательно') }}</Label>
      <Input v-if="action.type === 'remote-event'" :id="`${id}-text`" :model-value="actionText()" :disabled="disabled" maxlength="128" @update:model-value="setText" />
      <Textarea v-else :id="`${id}-text`" :model-value="actionText()" :disabled="disabled" class="min-h-24 resize-y" rows="3" maxlength="8192" @update:model-value="setText" />
    </div>
    <div v-if="action.type === 'new-chat'" class="grid min-w-0 gap-2"><Label :for="`${id}-project`">{{ text('ID проекта, необязательно') }}</Label><Input :id="`${id}-project`" :model-value="action.projectId ?? ''" :disabled="disabled" maxlength="256" @update:model-value="setProject" /></div>
  </fieldset>
</template>
