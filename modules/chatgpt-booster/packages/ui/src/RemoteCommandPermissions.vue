<script setup lang="ts">
import type { RemoteCommandKind } from '@kobaproduction/browser-core'
import {
  Badge,
  Button,
  Checkbox,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Label,
  useLocalizedText,
} from '@kobaproduction/browser-ui'
import { ChevronDown } from 'lucide-vue-next'
import { useId } from 'vue'
import { AUTOMATION_UI_MESSAGES } from './i18n/automation'

const text = useLocalizedText(AUTOMATION_UI_MESSAGES)

const props = defineProps<{ allowed: readonly RemoteCommandKind[]; disabled?: boolean }>()
const emit = defineEmits<{ change: [allowed: readonly RemoteCommandKind[]] }>()
const id = useId()
const groups: readonly { title: string; commands: readonly [RemoteCommandKind, string][] }[] = [
  {
    title: 'Управление диалогом',
    commands: [
      ['send-message', 'Отправлять сообщения'],
      ['stop', 'Останавливать ответ'],
      ['continue', 'Продолжать диалог'],
      ['new-chat', 'Создавать новый чат'],
    ],
  },
  {
    title: 'Просмотр триггеров',
    commands: [
      ['triggers-list', 'Список правил'],
      ['triggers-get-config', 'Конфигурация менеджера'],
      ['triggers-get', 'Просмотр отдельного правила'],
      ['triggers-get-unsaved', 'Несохранённые изменения'],
    ],
  },
  {
    title: 'Изменение триггеров',
    commands: [
      ['triggers-draft-set', 'Заменять правила в памяти'],
      ['triggers-draft-upsert', 'Добавлять и изменять правило'],
      ['triggers-draft-remove', 'Удалять правило из памяти'],
      ['triggers-draft-reset', 'Сбрасывать правила в памяти'],
      ['triggers-draft-save', 'Сохранять изменения'],
      ['triggers-draft-discard', 'Отменять несохранённые изменения'],
      ['triggers-set', 'Заменять сохранённые правила'],
      ['triggers-reset', 'Сбрасывать сохранённые правила'],
    ],
  },
  { title: 'Архив', commands: [['archive-sync', 'Отправлять сохранённый архив']] },
]
function change(command: RemoteCommandKind, checked: boolean | 'indeterminate') {
  if (props.disabled) return
  emit(
    'change',
    checked === true
      ? [...new Set([...props.allowed, command])]
      : props.allowed.filter((item) => item !== command),
  )
}
</script>

<template>
  <div class="grid min-w-0 gap-3">
    <Collapsible v-for="group in groups" :key="group.title" class="min-w-0 border-t first:border-t-0">
      <CollapsibleTrigger as-child><Button variant="ghost" class="group h-auto min-h-11 w-full justify-between gap-3 whitespace-normal px-2 text-left"><span class="min-w-0 flex-1">{{ text(group.title) }}</span><Badge variant="secondary" class="shrink-0" :aria-label="`${text('Разрешено ')}${group.commands.filter(([command]) => allowed.includes(command)).length}${text(' из ')}${group.commands.length}`">{{ group.commands.filter(([command]) => allowed.includes(command)).length }} / {{ group.commands.length }}</Badge><ChevronDown class="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" aria-hidden="true" /></Button></CollapsibleTrigger>
      <CollapsibleContent class="pb-3 pt-1"><div class="grid min-w-0 gap-2 min-[1024px]:grid-cols-2"><Label v-for="[command,title] in group.commands" :key="command" :for="`${id}-${command}`" class="flex min-h-10 min-w-0 items-center gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm"><Checkbox :id="`${id}-${command}`" :model-value="allowed.includes(command)" :disabled="disabled" @update:model-value="change(command,$event)" /><span class="min-w-0 leading-5">{{ text(title) }}</span></Label></div></CollapsibleContent>
    </Collapsible>
  </div>
</template>
