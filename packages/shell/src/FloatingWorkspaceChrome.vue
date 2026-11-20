<script setup lang="ts">
import { Button, Switch, TooltipHint, useApplicationLocale } from '@kobaproduction/browser-ui'
import { Minus, X } from 'lucide-vue-next'

defineProps<{
  title: string
  version?: string | undefined
  enabled: boolean
  powerDisabled: boolean
  powerLabel: string
  canMinimize: boolean
}>()
const emit = defineEmits<{
  begin: [event: PointerEvent, kind: 'move']
  power: [enabled: boolean]
  minimize: []
  close: []
}>()
const locale = useApplicationLocale()
const text = (ru: string, en: string) => (locale.value === 'ru' ? ru : en)
function beginMove(event: PointerEvent) {
  if (event.target instanceof Element && event.target.closest('button')) return
  emit('begin', event, 'move')
}
</script>

<template>
  <div class="booster-floating-chrome flex shrink-0 cursor-move touch-none select-none items-center gap-2 border-b bg-muted py-1 ps-3 pe-2"
    :aria-label="text('Переместить рабочее окно', 'Move workspace')" @pointerdown="beginMove">
    <slot />
    <span class="booster-floating-identity flex min-w-0 flex-1 items-baseline gap-2 text-xs font-semibold">
      <span class="truncate">{{ title }}</span><small v-if="version" class="booster-version shrink-0">{{ version }}</small>
    </span>
    <TooltipHint :label="powerLabel">
      <Switch :model-value="enabled" :disabled="powerDisabled" :aria-label="powerLabel" @update:model-value="emit('power', $event)" />
    </TooltipHint>
    <TooltipHint v-if="canMinimize" :label="text('Свернуть окно', 'Minimize window')">
      <Button type="button" variant="ghost" size="icon" class="size-7.5 shrink-0" :aria-label="text('Свернуть окно', 'Minimize window')" @click="emit('minimize')"><Minus class="size-4" /></Button>
    </TooltipHint>
    <TooltipHint :label="text('Закрыть окно', 'Close window')">
      <Button type="button" variant="ghost" size="icon" class="size-7.5 shrink-0" :aria-label="text('Закрыть окно', 'Close window')" @click="emit('close')"><X class="size-4" /></Button>
    </TooltipHint>
  </div>
</template>
