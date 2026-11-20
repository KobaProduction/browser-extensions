<script setup lang="ts">
import { Button, TooltipHint, useApplicationLocale } from '@kobaproduction/browser-ui'
import { Grip, GripVertical } from 'lucide-vue-next'
import { computed } from 'vue'

const props = defineProps<{ kind: 'move' | 'resize' }>()
const emit = defineEmits<{
  begin: [event: PointerEvent, kind: typeof props.kind]
  move: [event: PointerEvent]
  end: [event: PointerEvent]
  adjust: [event: KeyboardEvent, kind: typeof props.kind]
}>()
const locale = useApplicationLocale()
const label = computed(() =>
  props.kind === 'move'
    ? locale.value === 'ru'
      ? 'Переместить окно — используйте стрелки'
      : 'Move window using arrow keys'
    : locale.value === 'ru'
      ? 'Изменить размер окна — используйте стрелки'
      : 'Resize window using arrow keys',
)
</script>

<template>
  <TooltipHint :label="label">
    <Button type="button" variant="ghost" size="icon" :aria-label="label"
      :class="kind === 'move'
        ? 'booster-floating-handle size-7.5 shrink-0'
        : 'booster-floating-resize absolute end-0 bottom-0 size-7 cursor-nwse-resize touch-none'"
      @pointerdown.stop="emit('begin', $event, kind)" @pointermove="emit('move', $event)"
      @pointerup="emit('end', $event)" @pointercancel="emit('end', $event)"
      @keydown="emit('adjust', $event, kind)">
      <component :is="kind === 'move' ? GripVertical : Grip" class="size-4" aria-hidden="true" />
    </Button>
  </TooltipHint>
</template>
