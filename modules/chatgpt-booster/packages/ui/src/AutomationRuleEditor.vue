<script setup lang="ts">
import type { AutomationAction, AutomationRule, AutomationTrigger } from '@kobaproduction/browser-core'
import { validateAutomationRule } from '@kobaproduction/browser-core'
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingRow,
  useLocalizedText,
} from '@kobaproduction/browser-ui'
import { ref, useId } from 'vue'
import AutomationActionEditor from './AutomationActionEditor.vue'
import { AUTOMATION_UI_MESSAGES } from './i18n/automation'

const text = useLocalizedText(AUTOMATION_UI_MESSAGES)

const props = defineProps<{ rule?: AutomationRule; disabled?: boolean }>()
const emit = defineEmits<{ apply: [rule: AutomationRule]; cancel: [] }>()
const id = useId()
const label = ref(props.rule?.label ?? '')
const enabled = ref(props.rule?.enabled ?? false)
const triggerType = ref<AutomationTrigger['type']>(props.rule?.trigger.type ?? 'completion')
const eventName = ref(props.rule?.trigger.name ?? '')
const role = ref(props.rule?.trigger.role ?? 'any')
const outcome = ref(props.rule?.trigger.outcome ?? 'any')
const patternKind = ref(props.rule?.trigger.pattern?.kind ?? 'contains')
const pattern = ref(props.rule?.trigger.pattern?.value ?? '')
const caseSensitive = ref(props.rule?.trigger.pattern?.caseSensitive ?? false)
const cooldown = ref<string | number>(props.rule?.cooldownMs ?? 5000)
const actions = ref<AutomationAction[]>(
  (props.rule?.actions ?? [{ type: 'send-message' as const, text: '' }]).map((action) => ({
    ...action,
  })),
)
const error = ref('')
const events = [
  { id: 'message', title: 'Сообщение' },
  { id: 'api', title: 'Событие API' },
  { id: 'completion', title: 'Завершение запроса' },
  { id: 'limit', title: 'Лимит диалога' },
  { id: 'conflict', title: 'Конфликт версий' },
] as const
function apply() {
  if (props.disabled) return
  error.value = ''
  if (triggerType.value === 'dom') {
    error.value = 'События интерфейса больше не поддерживаются. Выберите сетевое событие.'
    return
  }
  try {
    if (String(cooldown.value).trim() === '') throw Error('Missing interval')
    const rule = validateAutomationRule({
      id: props.rule?.id ?? crypto.randomUUID(),
      label: label.value.trim(),
      enabled: enabled.value,
      cooldownMs: Number(cooldown.value),
      actions: actions.value,
      trigger: {
        type: triggerType.value,
        ...(!['message', 'completion'].includes(triggerType.value) && eventName.value.trim()
          ? { name: eventName.value.trim() }
          : {}),
        ...(triggerType.value === 'completion' && outcome.value !== 'any'
          ? { outcome: outcome.value }
          : {}),
        ...(triggerType.value === 'message' && role.value !== 'any' ? { role: role.value } : {}),
        ...(triggerType.value === 'message' && pattern.value
          ? {
              pattern: {
                kind: patternKind.value,
                value: pattern.value,
                caseSensitive: caseSensitive.value,
              },
            }
          : {}),
      },
    })
    emit('apply', rule)
  } catch {
    error.value =
      'Укажите название и допустимый интервал. Для отправки сообщения или события нужен непустой текст.'
  }
}
</script>

<template>
  <form class="min-w-0 space-y-4 border-t pt-4" :aria-label="rule ? text('Изменение правила') : text('Новое правило')" :aria-busy="disabled" @submit.prevent="apply">
    <div class="grid min-w-0 gap-3 min-[1024px]:grid-cols-2">
      <div class="grid gap-2"><Label :for="`${id}-label`">{{ text('Название правила') }}</Label><Input :id="`${id}-label`" v-model="label" :disabled="disabled" maxlength="128" autocomplete="off" /></div>
      <div class="grid gap-2"><Label :for="`${id}-type`">{{ text('Событие') }}</Label><Select v-model="triggerType" :disabled="disabled"><SelectTrigger :id="`${id}-type`"><SelectValue /></SelectTrigger><SelectContent><SelectItem v-for="event in events" :key="event.id" :value="event.id">{{ text(event.title) }}</SelectItem></SelectContent></Select></div>
    </div>
    <SettingRow flat :id="`${id}-enabled`" :title="text('Правило включено')" :description="text('Начнёт работать после применения в памяти, если менеджер включён.')" :model-value="enabled" :disabled="disabled" @update:model-value="enabled = $event" />
    <template v-if="triggerType === 'message'">
      <div class="grid min-w-0 gap-3 min-[1024px]:grid-cols-2">
        <div class="grid gap-2"><Label :for="`${id}-role`">{{ text('Автор сообщения') }}</Label><Select v-model="role" :disabled="disabled"><SelectTrigger :id="`${id}-role`"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">{{ text('Любой') }}</SelectItem><SelectItem value="user">{{ text('Пользователь') }}</SelectItem><SelectItem value="assistant">{{ text('Ассистент') }}</SelectItem><SelectItem value="tool">{{ text('Инструмент') }}</SelectItem></SelectContent></Select></div>
        <div class="grid gap-2"><Label :for="`${id}-pattern-kind`">{{ text('Сопоставление текста') }}</Label><Select v-model="patternKind" :disabled="disabled"><SelectTrigger :id="`${id}-pattern-kind`"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="contains">{{ text('Содержит') }}</SelectItem><SelectItem value="exact">{{ text('Точное совпадение') }}</SelectItem></SelectContent></Select></div>
      </div>
      <div class="grid gap-2"><Label :for="`${id}-pattern`">{{ text('Текст сообщения, необязательно') }}</Label><Input :id="`${id}-pattern`" v-model="pattern" :disabled="disabled" maxlength="512" :aria-describedby="`${id}-pattern-help`" /><p :id="`${id}-pattern-help`" class="text-xs leading-5 text-muted-foreground">{{ text('Пустое поле — любое сообщение выбранного автора.') }}</p></div>
      <Label :for="`${id}-case`" class="flex min-h-9 items-center gap-3"><Checkbox :id="`${id}-case`" :model-value="caseSensitive" :disabled="disabled || !pattern" @update:model-value="caseSensitive = $event === true" /><span>{{ text('Учитывать регистр') }}</span></Label>
    </template>
    <div v-else-if="triggerType === 'completion'" class="grid gap-2"><Label :for="`${id}-outcome`">{{ text('Результат запроса') }}</Label><Select v-model="outcome" :disabled="disabled"><SelectTrigger :id="`${id}-outcome`"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="any">{{ text('Любой') }}</SelectItem><SelectItem value="complete">{{ text('Завершено') }}</SelectItem><SelectItem value="failed">{{ text('Ошибка') }}</SelectItem><SelectItem value="cancelled">{{ text('Остановлено') }}</SelectItem><SelectItem value="context-exhausted">{{ text('Контекст исчерпан') }}</SelectItem></SelectContent></Select></div>
    <div v-else class="grid gap-2"><Label :for="`${id}-event`">{{ text('Имя события, необязательно') }}</Label><Input :id="`${id}-event`" v-model="eventName" :disabled="disabled" placeholder="request.started" maxlength="128" :aria-describedby="`${id}-event-help`" /><p :id="`${id}-event-help`" class="text-xs leading-5 text-muted-foreground">{{ text('Пустое поле — любое событие выбранного типа.') }}</p></div>
    <div class="grid gap-2"><Label :for="`${id}-cooldown`">{{ text('Минимальный интервал повторения, мс') }}</Label><Input :id="`${id}-cooldown`" v-model="cooldown" :disabled="disabled" type="number" min="0" max="86400000" step="1" :aria-describedby="`${id}-cooldown-help`" /><p :id="`${id}-cooldown-help`" class="text-xs leading-5 text-muted-foreground">{{ text('0 — без задержки. Повтор одного события и циклы автоматизации блокируются отдельно.') }}</p></div>
    <AutomationActionEditor v-for="(action, index) in actions" :key="index" :action="action" :index="index" :can-remove="actions.length > 1" :disabled="disabled" @update="actions[index] = $event" @remove="actions.splice(index, 1)" />
    <Button v-if="actions.length < 8" type="button" variant="outline" size="sm" :disabled="disabled" @click="actions.push({ type: 'stop' })">{{ text('Добавить действие') }}</Button>
    <Alert v-if="error" variant="destructive"><AlertDescription>{{ text(error) }}</AlertDescription></Alert>
    <div class="flex flex-wrap gap-2 border-t pt-3"><Button type="submit" :disabled="disabled">{{ text('Применить в памяти') }}</Button><Button type="button" variant="outline" :disabled="disabled" @click="emit('cancel')">{{ text('Отменить редактирование') }}</Button></div>
  </form>
</template>
